// Importações usando ES Modules
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import express from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.set('trust proxy', 1);

// Cache com TTL de 1 hora
const cache = new NodeCache({ stdTTL: 3600 });

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5
});

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/', limiter);

// Pool de navegadores
class BrowserPool {
    constructor(size = 2) {
        this.size = size;
        this.browsers = [];
        this.currentIndex = 0;
        this.initializing = false;
    }

    async initialize() {
        if (this.initializing) return;
        this.initializing = true;
        
        puppeteer.use(StealthPlugin());
        
        for (let i = 0; i < this.size; i++) {
            const browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1280,720'
                ]
            });
            this.browsers.push(browser);
        }
        
        this.initializing = false;
        console.log(`🚀 Pool com ${this.size} navegadores inicializado`);
    }

    async getBrowser() {
        if (this.browsers.length === 0) {
            await this.initialize();
        }
        
        const browser = this.browsers[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.size;
        return browser;
    }

    async closeAll() {
        for (const browser of this.browsers) {
            await browser.close();
        }
        this.browsers = [];
    }
}

const browserPool = new BrowserPool(2);

// User Agents
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
];

const BASE = "https://www.niointernet.com.br";

// Função para fazer requisições usando Puppeteer (alternativa ao axios)
async function fazerRequisicaoComPuppeteer(url, options = {}) {
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    try {
        // Configurar User Agent
        const userAgent = options.headers?.['User-Agent'] || userAgents[0];
        await page.setUserAgent(userAgent);

        // Configurar headers adicionais
        if (options.headers) {
            await page.setExtraHTTPHeaders(options.headers);
        }

        // Navegar para a URL
        const response = await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 10000
        });

        // Pegar cookies da página
        const cookies = await page.cookies();
        
        // Pegar o conteúdo da página
        const content = await page.content();
        
        // Tentar extrair JSON se for uma resposta JSON
        let data = null;
        try {
            const text = await page.evaluate(() => document.body.innerText);
            data = JSON.parse(text);
        } catch (e) {
            // Não é JSON, retorna o conteúdo HTML
            data = { html: content, cookies };
        }

        return {
            data,
            status: response.status(),
            headers: response.headers(),
            cookies
        };

    } finally {
        await page.close();
    }
}

// Versão simplificada da busca usando Puppeteer
async function buscarSegundaVia(cpf) {
    try {
        console.log(`🔍 Buscando dados para CPF: ${cpf}`);

        // Primeiro, visita a página principal para pegar cookies
        const browser = await browserPool.getBrowser();
        const page = await browser.newPage();
        
        try {
            await page.setUserAgent(userAgents[0]);
            
            // Visita a página principal
            await page.goto(`${BASE}/ajuda/servicos/segunda-via/`, {
                waitUntil: 'networkidle0',
                timeout: 10000
            });

            // Pega os cookies
            const cookies = await page.cookies();
            
            // Converte cookies para string
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            // Agora faz a requisição para a API usando a própria página
            const result = await page.evaluate(async (cpf, cookieString) => {
                const response = await fetch('https://www.niointernet.com.br/api/rest/invoices/document', {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        'Referer': 'https://www.niointernet.com.br/ajuda/servicos/segunda-via/',
                        'Origin': 'https://www.niointernet.com.br',
                        'Document': cpf,
                        'token': '1234567890abcdef',
                        'Cookie': cookieString
                    }
                });
                return response.json();
            }, cpf, cookieString);

            const url = result?.redirect;
            
            if (!url) {
                throw new Error('URL de redirecionamento não encontrada');
            }

            console.log(`🔗 URL de redirecionamento: ${url}`);

            // Faz o scraping da URL
            const dados = await webscrapperOtimizado(url);
            return dados;

        } finally {
            await page.close();
        }

    } catch (error) {
        console.error("❌ Erro na busca:", error.message);
        throw error;
    }
}

// Webscrapper otimizado
const webscrapperOtimizado = async (url) => {
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    try {
        console.log('🚀 Iniciando consulta da fatura...');

        // Bloquear recursos desnecessários
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'websocket'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // User Agent aleatório
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await page.setUserAgent(userAgent);

        // Navegar para a URL
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000
        });

        // Esperar pelos elementos
        try {
            await page.waitForSelector('.resultados-entry', { 
                timeout: 5000,
                visible: true 
            });
        } catch (e) {
            console.log('⏰ Timeout na espera, continuando...');
        }

        // Extrair dados
        const dados = await page.evaluate(() => {
            const cpfElement = document.querySelector('.resultados__label');
            const nomeElement = document.querySelector('.resultados__name');
            const counterElement = document.querySelector('.resultados__counter-highlight');

            const contas = [];
            const entries = document.querySelectorAll('.resultados-entry');

            entries.forEach(entry => {
                const titulo = entry.querySelector('.resultados-entry__cell.title')?.textContent?.trim();
                const valor = entry.querySelector('.resultados-entry__cell.amount')?.textContent?.trim();
                const vencimento = entry.querySelector('.resultados-entry__cell.due-date')?.textContent?.trim();

                const statusElement = entry.querySelector('.resultados-status-chip');
                const status = statusElement?.textContent?.trim();
                const statusClass = statusElement?.className?.includes('open') ? 'em_aberto' : 'outro';

                contas.push({ titulo, valor, vencimento, status, statusClass });
            });

            return {
                cliente: {
                    cpf: cpfElement?.textContent?.replace('CPF:', '')?.trim() || null,
                    nome: nomeElement?.textContent?.trim() || null,
                    totalContas: counterElement?.textContent?.trim()?.replace(/\D/g, '') || null
                },
                contas: contas
            };
        });

        console.log('✅ Dados extraídos com sucesso!');
        return dados;

    } catch (error) {
        console.error('❌ Erro no webscrapper:', error);
        throw error;
    } finally {
        await page.close();
    }
};

// Endpoint principal
app.post('/api/search', async (req, res) => {
    const { cpf } = req.body;

    if (!cpf) {
        return res.status(400).json({
            success: false,
            error: 'CPF é obrigatório'
        });
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
        return res.status(400).json({
            success: false,
            error: 'CPF deve ter 11 dígitos'
        });
    }

    // Verifica cache
    const cacheKey = `fatura_${cpfLimpo}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
        console.log(`📦 Cache hit para CPF: ${cpf}`);
        return res.json({
            success: true,
            data: cachedData,
            fromCache: true,
            message: 'Consulta realizada com sucesso (cache)'
        });
    }

    console.log(`📨 Requisição para CPF: ${cpf}`);

    try {
        const startTime = Date.now();
        const dados = await buscarSegundaVia(cpfLimpo);
        const endTime = Date.now();
        
        console.log(`⏱️ Tempo de execução: ${(endTime - startTime) / 1000}s`);

        cache.set(cacheKey, dados);

        return res.json({
            success: true,
            data: dados,
            executionTime: `${(endTime - startTime) / 1000}s`,
            message: 'Consulta realizada com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro na consulta:', error);

        return res.status(500).json({
            success: false,
            error: 'Erro ao processar consulta',
            details: error.message
        });
    }
});

// Endpoint de status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        cacheSize: cache.keys().length,
        browsersActive: browserPool.browsers.length,
        timestamp: new Date().toISOString()
    });
});

// Inicialização
browserPool.initialize().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Encerrando servidor...');
    await browserPool.closeAll();
    process.exit(0);
});

// Export para Vercel
export default app;

// Inicia o servidor se não estiver no Vercel
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`✅ SERVER OTIMIZADO RODANDO NA PORTA ${PORT}`);
    });
}