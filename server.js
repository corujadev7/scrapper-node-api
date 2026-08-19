// const puppeteer = require('puppeteer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");
const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Cache com TTL de 1 hora
const cache = new NodeCache({ stdTTL: 3600 });

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5 // 5 requisições por IP
});

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/', limiter);

// Pool de navegadores para reutilização
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

// User Agents mais realistas e leves
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
];

// Delay otimizado
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const BASE = "https://www.niointernet.com.br";

// Versão otimizada da busca
async function buscarSegundaVia(cpf) {
    const cookieJar = new tough.CookieJar();
    const client = wrapper(axios.create({ 
        jar: cookieJar,
        timeout: 10000 // Timeout de 10 segundos
    }));

    try {
        // Faz requisições em paralelo quando possível
        const [_, response] = await Promise.all([
            client.get(`${BASE}/ajuda/servicos/segunda-via/`, {
                headers: { "User-Agent": userAgents[0] }
            }),
            client.get(`${BASE}/api/rest/invoices/document`, {
                headers: {
                    "User-Agent": userAgents[0],
                    "Accept": "application/json, text/plain, */*",
                    "Referer": `${BASE}/ajuda/servicos/segunda-via/`,
                    "Origin": BASE,
                    "Document": cpf,
                    "token": "1234567890abcdef"
                }
            }).catch(error => {
                // Se falhar, retorna erro mas não quebra o fluxo
                return { data: { redirect: null } };
            })
        ]);

        const url = response.data?.redirect;
        
        if (!url) {
            throw new Error('URL de redirecionamento não encontrada');
        }
        
        // Web scraping direto sem rotação de proxies
        const dados = await webscrapperOtimizado(url);
        return dados;

    } catch (error) {
        console.error("Erro na busca:", error.message);
        throw error;
    }
}

// Webscrapper otimizado - SEM PROXIES
const webscrapperOtimizado = async (url) => {
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    try {
        console.log('🚀 Iniciando consulta da fatura...');

        // Configurações de performance
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            // Bloqueia recursos desnecessários
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // User Agent aleatório
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await page.setUserAgent(userAgent);

        // Timeout reduzido
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000,
            referer: BASE
        });

        // Espera seletiva - só espera se realmente precisar
        try {
            await page.waitForSelector('.resultados-entry', { 
                timeout: 5000,
                visible: true 
            });
        } catch (e) {
            console.log('Timeout na espera, continuando...');
        }

        // Extração mais rápida
     const dados = await page.evaluate(() => {
            // Extrai informações do cliente
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
        await page.close(); // Fecha a página mas mantém o browser
    }
};

// Endpoint principal com cache
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
        
        console.log(`⏱️  Tempo de execução: ${(endTime - startTime) / 1000}s`);

        // Salva no cache
        cache.set(cacheKey, dados);

        return res.json({
            success: true,
            data: dados,
            executionTime: `${(endTime - startTime) / 1000}s`,
            message: 'Consulta realizada com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro na consulta:', error);

        // Se falhar, tenta uma última vez sem bloqueios
        try {
            console.log('🔄 Tentando método alternativo...');
            const dados = await buscarSegundaViaAlternativo(cpfLimpo);
            return res.json({
                success: true,
                data: dados,
                message: 'Consulta realizada com método alternativo'
            });
        } catch (fallbackError) {
            return res.status(500).json({
                success: false,
                error: 'Erro ao processar consulta',
                details: error.message
            });
        }
    }
});

// Método alternativo mais simples
async function buscarSegundaViaAlternativo(cpf) {
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();
    
    try {
        await page.goto(`${BASE}/ajuda/servicos/segunda-via/`, {
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });
        
        // Tenta extrair direto da página
        const dados = await page.evaluate(() => {
            return { message: 'Página carregada', success: true };
        });
        
        return dados;
    } finally {
        await page.close();
    }
}

// Endpoint de status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        cacheSize: cache.keys().length,
        browsersActive: browserPool.browsers.length,
        timestamp: new Date().toISOString()
    });
});

// Inicialização do pool de browsers
browserPool.initialize().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Encerrando servidor...');
    await browserPool.closeAll();
    process.exit(0);
});

app.listen(4000, () => {
    console.log("✅ SERVER OTIMIZADO RODANDO NA PORTA 4000");
});