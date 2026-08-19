// const puppeteer = require('puppeteer');
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import express from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

// Plugin stealth registrado UMA única vez, fora da classe do pool
puppeteer.use(StealthPlugin());

const app = express();

// ==== Configurações via ambiente (nada de token/URL fixos no código) ====
const BASE = process.env.BASE_URL || 'https://www.niointernet.com.br';
const API_TOKEN = process.env.API_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const PORT = process.env.PORT || 4000;
const MAX_CONCURRENT_PAGES = Number(process.env.MAX_CONCURRENT_PAGES || 4);

if (!API_TOKEN) {
    console.warn('⚠️  API_TOKEN não definido no .env — as requisições ao site alvo provavelmente vão falhar.');
}

// Cache com TTL de 1 hora
const cache = new NodeCache({ stdTTL: 3600 });

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 5 // 5 requisições por IP
});

// CORS restrito a origem(ns) conhecida(s), não '*'
const corsOptions = {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/', limiter);

// ==== Semáforo simples para limitar páginas simultâneas no total ====
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    acquire() {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                if (this.current < this.max) {
                    this.current++;
                    resolve();
                } else {
                    this.queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    release() {
        this.current--;
        const next = this.queue.shift();
        if (next) next();
    }
}

const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

// ==== Pool de navegadores para reutilização, com recuperação de crash ====
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

        for (let i = 0; i < this.size; i++) {
            await this._launchBrowser(i);
        }

        this.initializing = false;
        console.log(`🚀 Pool com ${this.size} navegadores inicializado`);
    }

    async _launchBrowser(slot) {
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

        // Se o browser cair (crash/OOM), relança automaticamente nesse slot
        browser.on('disconnected', () => {
            console.warn(`⚠️  Browser no slot ${slot} desconectou. Relançando...`);
            this._launchBrowser(slot).then((newBrowser) => {
                this.browsers[slot] = newBrowser;
            }).catch((err) => {
                console.error(`❌ Falha ao relançar browser no slot ${slot}:`, err.message);
            });
        });

        this.browsers[slot] = browser;
        return browser;
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
            if (browser) await browser.close().catch(() => {});
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

const BASE_PATH_SEGUNDA_VIA = `${BASE}/ajuda/servicos/segunda-via/`;

// Busca principal
async function buscarSegundaVia(cpf) {
    const cookieJar = new CookieJar();
    const client = wrapper(axios.create({
        jar: cookieJar,
        timeout: 10000
    }));

    try {
        const [_, response] = await Promise.all([
            client.get(BASE_PATH_SEGUNDA_VIA, {
                headers: { "User-Agent": userAgents[0] }
            }),
            client.get(`${BASE}/api/rest/invoices/document`, {
                headers: {
                    "User-Agent": userAgents[0],
                    "Accept": "application/json, text/plain, */*",
                    "Referer": BASE_PATH_SEGUNDA_VIA,
                    "Origin": BASE,
                    "Document": cpf,
                    "token": API_TOKEN
                }
            }).catch(() => ({ data: { redirect: null } }))
        ]);

        const url = response.data?.redirect;

        if (!url) {
            throw new Error('URL de redirecionamento não encontrada');
        }

        return await webscrapperOtimizado(url);

    } catch (error) {
        console.error("Erro na busca:", error.message);
        throw error;
    }
}

// Webscrapper otimizado — controla concorrência via semáforo
const webscrapperOtimizado = async (url) => {
    await pageSemaphore.acquire();

    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();

    try {
        console.log('🚀 Iniciando consulta da fatura...');

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await page.setUserAgent(userAgent);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
            referer: BASE
        });

        try {
            await page.waitForSelector('.resultados-entry', {
                timeout: 5000,
                visible: true
            });
        } catch (e) {
            console.log('Timeout na espera, continuando...');
        }

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
        await page.close().catch(() => {});
        pageSemaphore.release();
    }
};

// ==== Deduplicação de requisições concorrentes pro mesmo CPF (evita stampede) ====
const pendingRequests = new Map();

async function buscarComDeduplicacao(cpfLimpo) {
    if (pendingRequests.has(cpfLimpo)) {
        console.log(`⏳ Requisição já em andamento para CPF: ${cpfLimpo}, aguardando...`);
        return pendingRequests.get(cpfLimpo);
    }

    const promise = buscarSegundaVia(cpfLimpo).finally(() => {
        pendingRequests.delete(cpfLimpo);
    });

    pendingRequests.set(cpfLimpo, promise);
    return promise;
}

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
        const dados = await buscarComDeduplicacao(cpfLimpo);
        const endTime = Date.now();

        console.log(`⏱️  Tempo de execução: ${(endTime - startTime) / 1000}s`);

        cache.set(cacheKey, dados);

        return res.json({
            success: true,
            data: dados,
            executionTime: `${(endTime - startTime) / 1000}s`,
            message: 'Consulta realizada com sucesso'
        });

    } catch (error) {
        // Log completo no servidor, mensagem genérica pro cliente
        console.error('❌ Erro na consulta:', error);

        try {
            console.log('🔄 Tentando método alternativo...');
            const dados = await buscarSegundaViaAlternativo(cpfLimpo);
            return res.json({
                success: true,
                data: dados,
                message: 'Consulta realizada com método alternativo'
            });
        } catch (fallbackError) {
            console.error('❌ Erro no método alternativo:', fallbackError);
            return res.status(500).json({
                success: false,
                error: 'Erro ao processar consulta. Tente novamente mais tarde.'
            });
        }
    }
});

// Método alternativo — reaproveita a mesma lógica de extração como plano B real
async function buscarSegundaViaAlternativo(cpf) {
    await pageSemaphore.acquire();
    const browser = await browserPool.getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto(BASE_PATH_SEGUNDA_VIA, {
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });

        // Aqui você reaproveitaria a extração de fato (ex: preencher form com o CPF
        // e reusar a mesma lógica de page.evaluate de webscrapperOtimizado).
        // Deixado como placeholder explícito para não passar a falsa impressão
        // de que já é um fallback funcional.
        throw new Error('Método alternativo ainda não implementado para extração real de dados');

    } finally {
        await page.close().catch(() => {});
        pageSemaphore.release();
    }
}

// Endpoint de status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        cacheSize: cache.keys().length,
        browsersActive: browserPool.browsers.filter(Boolean).length,
        pendingRequests: pendingRequests.size,
        pageSemaphoreInUse: pageSemaphore.current,
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

app.listen(PORT, () => {
    console.log(`✅ SERVER OTIMIZADO RODANDO NA PORTA ${PORT}`);
});