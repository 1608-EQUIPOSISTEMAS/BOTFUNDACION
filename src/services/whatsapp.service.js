const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const logger = require('../utils/logger');
const campaignService = require('./campaign.service');
const rateLimitService = require('./ratelimit.service');
const conversationService = require('./conversation.service');
const messageService = require('./message.service');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.qrCodeData = null;
        this.isReady = false;
        this.isInitializing = false;
        this.currentRole = null;
        this.currentPermissions = [];
    }

    /**
     * Inicializa el cliente de WhatsApp
     * @param {string} role - Rol del usuario
     * @param {Array} permissions - Permisos del usuario
     * @returns {Promise<void>}
     */
    async initialize(role = 'user', permissions = []) {
        try {
            if (this.isInitializing) {
                throw new Error('El cliente ya se está inicializando');
            }

            if (this.client) {
                throw new Error('El cliente ya está inicializado');
            }

            this.isInitializing = true;
            this.currentRole = role;
            this.currentPermissions = permissions;
            this.qrCodeData = null;

            logger.info(`[WHATSAPP] Inicializando cliente con rol: ${role}`);

            // Crear cliente con LocalAuth para persistir sesión
            this.client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: './.wwebjs_auth'
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu'
                    ]
                },
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
                }
            });

            this.setupEventHandlers();

            // Inicializar cliente
            await this.client.initialize();

            logger.info('[WHATSAPP] Cliente inicializado correctamente');

        } catch (error) {
            this.isInitializing = false;
            logger.error('[WHATSAPP] Error inicializando cliente:', error);
            throw error;
        }
    }

    /**
     * Configura los event handlers del cliente
     */
    setupEventHandlers() {
        // Evento: QR Code generado
        this.client.on('qr', async (qr) => {
            try {
                logger.info('[WHATSAPP] QR Code generado');
                
                // Convertir QR a data URL (base64)
                this.qrCodeData = await qrcode.toDataURL(qr);
                
                logger.info('[WHATSAPP] QR Code convertido a base64, listo para mostrar');
            } catch (error) {
                logger.error('[WHATSAPP] Error generando QR Code:', error);
            }
        });

        // Evento: Cliente listo
        this.client.on('ready', async () => {
            this.isReady = true;
            this.isInitializing = false;
            this.qrCodeData = null;
            
            const info = this.client.info;
            logger.info(`[WHATSAPP] ✅ Cliente conectado exitosamente`);
            logger.info(`[WHATSAPP] Número: ${info.wid.user}`);
            logger.info(`[WHATSAPP] Nombre: ${info.pushname}`);
        });

        // Evento: Autenticación exitosa
        this.client.on('authenticated', () => {
            logger.info('[WHATSAPP] Autenticación exitosa');
        });

        // Evento: Fallo de autenticación
        this.client.on('auth_failure', (msg) => {
            this.isReady = false;
            this.isInitializing = false;
            logger.error('[WHATSAPP] ❌ Fallo de autenticación:', msg);
        });

        // Evento: Cliente desconectado
        this.client.on('disconnected', (reason) => {
            this.isReady = false;
            this.qrCodeData = null;
            logger.warn(`[WHATSAPP] Cliente desconectado: ${reason}`);
        });

        // Evento: Mensaje recibido (PRINCIPAL)
        this.client.on('message', async (message) => {
            await this.handleIncomingMessage(message);
        });

        // Evento: Error
        this.client.on('error', (error) => {
            logger.error('[WHATSAPP] Error en el cliente:', error);
        });
    }

    /**
     * Maneja mensajes entrantes (LÓGICA PRINCIPAL DEL BOT)
     * @param {object} message - Mensaje de WhatsApp
     */
    async handleIncomingMessage(message) {
        try {
            // Ignorar mensajes propios
            if (message.fromMe) {
                return;
            }

            // Ignorar mensajes de grupos
            if (message.from.includes('@g.us')) {
                logger.debug('[WHATSAPP] Mensaje de grupo ignorado');
                return;
            }

            const userPhone = message.from;
            const messageText = message.body;

            // Ignorar mensajes vacíos
            if (!messageText || messageText.trim().length === 0) {
                return;
            }

            // Obtener información del contacto
            const contact = await message.getContact();
            const userName = contact.pushname || contact.name || 'Usuario';

            logger.info(`[WHATSAPP] 📨 Mensaje recibido de ${userPhone} (${userName}): "${messageText}"`);

            // PASO 1: Verificar si ya tiene una conversación activa
            const activeConversation = await conversationService.getActiveConversation(userPhone);
            if (activeConversation) {
                logger.info(`[WHATSAPP] Usuario ${userPhone} tiene conversación activa (ID: ${activeConversation.id}), ignorando mensaje`);
                return;
            }

            // PASO 2: Verificar rate limiting
            const rateLimitCheck = await rateLimitService.checkRateLimit(userPhone);
            if (!rateLimitCheck.allowed) {
                logger.warn(`[WHATSAPP] Rate limit excedido para ${userPhone}: ${rateLimitCheck.reason}`);
                
                const rateLimitMessage = this.getRateLimitMessage(rateLimitCheck.reason);
                await message.reply(rateLimitMessage);
                return;
            }

            // PASO 3: Detectar campaña por keywords
            const campaignMatch = await campaignService.detectCampaign(messageText);
            if (!campaignMatch) {
                logger.info(`[WHATSAPP] No se detectó ninguna campaña para el mensaje: "${messageText}"`);
                return;
            }

            logger.info(`[WHATSAPP] 🎯 Campaña detectada: "${campaignMatch.campaignName}" (ID: ${campaignMatch.campaignId}) - Keyword: "${campaignMatch.matchedKeyword}" - Tipo: ${campaignMatch.matchType}`);

            // PASO 4: Actualizar rate limit
            await rateLimitService.updateRateLimit(userPhone);

            // PASO 5: Crear conversación
            const conversationId = await conversationService.createConversation({
                userPhone,
                userName,
                campaignId: campaignMatch.campaignId,
                triggerMessage: messageText,
                matchedKeyword: campaignMatch.matchedKeyword,
                matchType: campaignMatch.matchType
            });

            logger.info(`[WHATSAPP] 💬 Conversación creada: ID ${conversationId}`);

            // PASO 6: Obtener mensajes de la campaña
            const messages = await messageService.getCampaignMessages(campaignMatch.campaignId);
            
            if (messages.length === 0) {
                logger.warn(`[WHATSAPP] La campaña ${campaignMatch.campaignId} no tiene mensajes configurados`);
                await conversationService.failConversation(conversationId, 'Sin mensajes configurados');
                return;
            }

            logger.info(`[WHATSAPP] 📤 Iniciando envío de ${messages.length} mensajes a ${userPhone}`);

            // PASO 7: Enviar mensajes secuencialmente
            const variables = {
                nombre: userName,
                telefono: userPhone
            };

            const result = await messageService.sendSequentialMessages(
                this.client,
                userPhone,
                conversationId,
                messages,
                variables
            );

            // PASO 8: Finalizar conversación
            if (result.sent === messages.length) {
                await conversationService.completeConversation(conversationId);
                logger.info(`[WHATSAPP] ✅ Conversación ${conversationId} completada exitosamente: ${result.sent}/${result.total} mensajes enviados`);
            } else if (result.failed === messages.length) {
                await conversationService.failConversation(conversationId, 'Todos los mensajes fallaron');
                logger.error(`[WHATSAPP] ❌ Conversación ${conversationId} fallida: ${result.failed}/${result.total} mensajes fallaron`);
            } else {
                await conversationService.completeConversation(conversationId);
                logger.warn(`[WHATSAPP] ⚠️ Conversación ${conversationId} completada con errores: ${result.sent}/${result.total} enviados, ${result.failed} fallidos`);
            }

        } catch (error) {
            logger.error('[WHATSAPP] Error procesando mensaje:', error);
        }
    }

    /**
     * Obtiene el mensaje apropiado según el tipo de rate limit
     */
    getRateLimitMessage(reason) {
        const messages = {
            'RATE_LIMIT_HOUR': '🕐 Has consultado varias veces en la última hora. Por favor espera unos minutos antes de volver a intentar.\n\nPara atención inmediata contacta:\n📞 +51 987 654 321',
            'RATE_LIMIT_DAY': '📊 Has alcanzado el límite de consultas diarias. Mañana podrás volver a usar el bot.\n\nPara atención inmediata:\n📞 +51 987 654 321\n📧 contacto@inmobiliaria.com',
            'BLOCKED_TEMPORARY': '🚫 Tu número está temporalmente bloqueado. Por favor contacta a soporte.',
            'BLOCKED_PERMANENT': '🚫 Tu número está en la lista de bloqueados. Contacta a soporte si crees que es un error.'
        };

        return messages[reason] || 'No puedes usar el bot en este momento. Contacta a soporte.';
    }

    /**
     * Obtiene el estado actual del cliente
     */
    getStatus() {
        return {
            isReady: this.isReady,
            isInitializing: this.isInitializing,
            hasQR: this.qrCodeData !== null,
            role: this.currentRole
        };
    }

    /**
     * Obtiene el QR Code actual
     */
    getQRCode() {
        return this.qrCodeData;
    }

    /**
     * Destruye el cliente y limpia la sesión
     */
    async destroy() {
        try {
            if (this.client) {
                logger.info('[WHATSAPP] Destruyendo cliente...');
                await this.client.destroy();
                this.client = null;
                this.isReady = false;
                this.isInitializing = false;
                this.qrCodeData = null;
                logger.info('[WHATSAPP] Cliente destruido exitosamente');
            }
        } catch (error) {
            logger.error('[WHATSAPP] Error destruyendo cliente:', error);
            throw error;
        }
    }

    /**
     * Verifica si el cliente está listo
     */
    isClientReady() {
        return this.isReady && this.client !== null;
    }
}

// Exportar instancia única (Singleton)
module.exports = new WhatsAppService();