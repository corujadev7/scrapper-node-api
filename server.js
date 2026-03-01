// server.js - ES Module version
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import tough from 'tough-cookie';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Configuração para __dirname em ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
app.use(express.json());

// Lista de proxies com autenticação
const proxyList = [
    'http://CPaQ2m1eSjA5UVB:hJgCMKc3QfuUOqg@178.94.165.81:44759',
    'http://mvaJFI2JuOC6BuX:Bd2GHvCWKtLpqWD@178.83.118.82:45626',
    // Adicione mais proxies aqui
];

// Lista de User Agents para rotação
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

// Configura o plugin stealth
puppeteer.use(StealthPlugin());

// Função para selecionar proxy aleatório
function getRandomProxy() {
    const randomIndex = Math.floor(Math.random() * proxyList.length);
    return proxyList[randomIndex];
}

// Função para selecionar User Agent aleatório
function getRandomUserAgent() {
    const randomIndex = Math.floor(Math.random() * userAgents.length);
    return userAgents[randomIndex];
}

// Função para delay aleatório entre requisições
function randomDelay(min = 3000, max = 7000) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

// Função para extrair credenciais do proxy
function parseProxy(proxyString) {
    try {
        // Formato: http://user:pass@host:port
        const matches = proxyString.match(/http:\/\/(.+?):(.+?)@(.+?):(\d+)/);
        if (matches) {
            return {
                username: matches[1],
                password: matches[2],
                host: matches[3],
                port: parseInt(matches[4])
            };
        }
        return null;
    } catch (error) {
        console.error('Erro ao parsear proxy:', error);
        return null;
    }
}

const BASE = "https://www.niointernet.com.br";

async function buscarSegundaVia(cpf) {
    // Cria cookie jar (equivalente ao requests.Session)
    const cookieJar = new tough.CookieJar();
    const client = wrapper(axios.create({ jar: cookieJar }));

    try {
        // 1️⃣ Primeiro acessa a página para gerar cookies
        await client.get(`${BASE}/ajuda/servicos/segunda-via/`, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });

        // 2️⃣ Agora faz a chamada da API com headers completos
        const response = await client.get(`${BASE}/api/rest/invoices/document`, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json, text/plain, */*",
                "Referer": `${BASE}/ajuda/servicos/segunda-via/`,
                "Origin": BASE,
                "Document": cpf,
                "token": "1234567890abcdef"
            }
        });

        console.log("Status:", response.status);
        console.log("Resposta bruta:", response.data);

        const url = response.data.redirect;
        
        // Chama o webscrapper com rotação de proxies
        const dados = await webscrapperComRotacao(url);
        return dados;

    } catch (error) {
        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Resposta erro:", error.response.data);
        } else {
            console.error("Erro:", error.message);
        }
        throw error;
    }
}

// Função principal do webscrapper que aceita proxy
const webscrapper = async (url, proxyString = null) => {
    // Configurações do navegador
    const launchOptions = {
        headless: true,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-position=0,0',
            '--window-size=1280,720',
            '--lang=pt-BR,pt',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--flag-switches-begin',
            '--disable-features=ChromeWhatsNewUI',
            '--flag-switches-end',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-features=SSLCommittedInterstitials',
            '--disable-quic'
        ]
    };

    // Adiciona proxy se fornecido
    if (proxyString) {
        const proxyData = parseProxy(proxyString);
        if (proxyData) {
            launchOptions.args.push(`--proxy-server=${proxyData.host}:${proxyData.port}`);
            console.log(`🔌 Usando proxy: ${proxyData.host}:${proxyData.port}`);
        }
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    try {
        console.log('🚀 Iniciando consulta da fatura...');

        // Configura autenticação do proxy se necessário
        if (proxyString) {
            const proxyData = parseProxy(proxyString);
            if (proxyData && proxyData.username && proxyData.password) {
                await page.authenticate({
                    username: proxyData.username,
                    password: proxyData.password
                });
            }
        }

        // Configura User Agent aleatório
        const userAgent = getRandomUserAgent();
        await page.setUserAgent(userAgent);
        console.log(`📱 User Agent: ${userAgent.substring(0, 50)}...`);

        // Configura headers adicionais
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        // Scripts de evasão
        await page.evaluateOnNewDocument(() => {
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });

            // Remove plugins de automação
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // Remove linguagens de automação
            Object.defineProperty(navigator, 'languages', {
                get: () => ['pt-BR', 'pt', 'en-US', 'en'],
            });

            // Remove a propriedade chrome (opcional)
            window.chrome = {
                runtime: {}
            };

            // Adiciona permissões falsas
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            // Remove a detecção de webdriver do navegador
            delete navigator.__proto__.webdriver;
            
            // Adiciona fingerprint falsa
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32'
            });
            
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8
            });
            
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8
            });
        });

        // Delay aleatório antes de navegar (simula comportamento humano)
        await randomDelay(2000, 4000);

        console.log('📡 Acessando site da nio...');
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000, 
            ignoreHTTPSErrors: true 
        });

        // Simula movimento do mouse
        await page.mouse.move(
            Math.random() * 500, 
            Math.random() * 500
        );

        await page.waitForSelector('.resultados', {
            timeout: 10000,
            visible: true
        });

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
        await randomDelay(2000, 5000);
        await browser.close();
    }
};

// Função que faz rotação de proxies com tentativas
async function webscrapperComRotacao(url, maxTentativas = 3) {
    let tentativa = 0;
    let ultimoErro = null;

    while (tentativa < maxTentativas) {
        try {
            // Seleciona proxy aleatório
            const proxy = getRandomProxy();
            
            // Delay aleatório entre tentativas
            await randomDelay(5000, 10000);
            
            console.log(`\n🔄 Tentativa ${tentativa + 1} de ${maxTentativas} com proxy diferente`);
            
            // Executa o webscrapper com o proxy selecionado
            const resultado = await webscrapper(url, proxy);
            
            return resultado; // Sucesso!
            
        } catch (error) {
            ultimoErro = error;
            console.log(`⚠️ Tentativa ${tentativa + 1} falhou:`, error.message);
            tentativa++;
            
            if (tentativa < maxTentativas) {
                console.log(`⏳ Aguardando ${tentativa * 5} segundos antes da próxima tentativa...`);
                await randomDelay(5000 * tentativa, 10000 * tentativa); // Delay progressivo
            }
        }
    }

    throw new Error(`Todas as ${maxTentativas} tentativas falharam. Último erro: ${ultimoErro.message}`);
}

app.post('/api/search', async (req, res) => {
    const { cpf } = req.body;

    console.log(cpf)
    // Validação
    if (!cpf) {
        return res.status(400).json({
            success: false,
            error: 'CPF é obrigatório'
        });
    }

    // Remove máscara para validação
    const cpfLimpo = cpf.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
        return res.status(400).json({
            success: false,
            error: 'CPF deve ter 11 dígitos'
        });
    }
    console.log(`📨 Requisição recebida para CPF: ${cpf}`);

    try {
        // Executa o scraping com rotação de proxies
        const dados = await buscarSegundaVia(cpfLimpo);

        return res.json({
            success: true,
            data: dados,
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

app.post('/api/transaction', async (req, res) => {
    try {
        const { nome, cpf, amount, titulo } = req.body;

        const email = nome.toLowerCase() + '@email.com';
        const cpfLimpo = cpf.replace(/\D/g, '');

        const url = process.env.URL;
        const publicKey = process.env.PUBLIC_KEY;
        const secretKey = process.env.SECRET_KEY;
        const auth = 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

        const value = amount.replace(',', '.');
        const newAmount = parseFloat(value) * 100;

        const response = await axios.post(url, {
            amount: newAmount,
            currency: 'BRL',
            paymentMethod: 'pix',
            pix: { expiresInDays: 1 },
            customer: {
                name: nome,
                email: email,
                document: { type: 'cpf', number: cpfLimpo }
            },
            items: [{
                title: titulo,
                unitPrice: newAmount,
                quantity: 1,
                tangible: false
            }]
        }, {
            headers: {
                accept: 'application/json',
                authorization: auth,
                'content-type': 'application/json'
            }
        });
        
        console.log(response.data);

        const qrCode = response.data.pix.qrcode;
        const id = response.data.id;

        res.json({ id: id, qrcode: qrCode, success: true });

    } catch (error) {
        console.error('Erro na requisição:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro na requisição' });
    }
});

app.listen(4000, () => {
    console.log("✅ SERVER IS RUNNING OK... ");
});

export default app;