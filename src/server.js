const express = require('express');
const cors = require('cors');
const config = require('./config/config2');
const logger = require('./utils/logger');
const whatsappService = require('./services/whatsapp.service');
const dbRoles = require('./config/database');
const dbInmobiliaria = require('./config/database2');

const app = express();
const PORT = config.server.port || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// ==================== ENDPOINTS ====================

/**
 * POST /start-whatsapp
 * Inicia el bot de WhatsApp con rol y permisos
 */
app.post('/start-whatsapp', async (req, res) => {
    try {
        const { role, permissions } = req.body;

        logger.info(`[API] Solicitud de inicio de WhatsApp - Rol: ${role}`);

        // Validar rol
        if (!role) {
            return res.status(400).json({
                success: false,
                message: 'El campo "role" es requerido'
            });
        }

        // Verificar si ya está inicializado
        const status = whatsappService.getStatus();
        if (status.isReady) {
            return res.json({
                success: true,
                message: 'WhatsApp ya está conectado',
                status: 'connected',
                qr: null
            });
        }

        if (status.isInitializing) {
            return res.json({
                success: true,
                message: 'WhatsApp se está inicializando',
                status: 'initializing',
                qr: whatsappService.getQRCode()
            });
        }

        // Iniciar WhatsApp
        whatsappService.initialize(role, permissions || [])
            .then(() => {
                logger.info('[API] WhatsApp inicializado correctamente');
            })
            .catch((error) => {
                logger.error('[API] Error inicializando WhatsApp:', error);
            });

        // Responder inmediatamente (el QR se obtendrá con /get-qr)
        res.json({
            success: true,
            message: 'Inicialización de WhatsApp en progreso',
            status: 'initializing',
            qr: null
        });

    } catch (error) {
        logger.error('[API] Error en /start-whatsapp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al iniciar WhatsApp: ' + error.message
        });
    }
});

/**
 * GET /get-qr
 * Obtiene el código QR actual o el estado de conexión
 */
app.get('/get-qr', async (req, res) => {
    try {
        const status = whatsappService.getStatus();
        const qrCode = whatsappService.getQRCode();

        if (status.isReady) {
            return res.json({
                status: 'connected',
                qr: null,
                message: 'WhatsApp está conectado'
            });
        }

        if (status.isInitializing && qrCode) {
            return res.json({
                status: 'qr_ready',
                qr: qrCode,
                message: 'Escanea el código QR'
            });
        }

        if (status.isInitializing && !qrCode) {
            return res.json({
                status: 'initializing',
                qr: null,
                message: 'Generando código QR...'
            });
        }

        res.json({
            status: 'disconnected',
            qr: null,
            message: 'WhatsApp no está conectado'
        });

    } catch (error) {
        logger.error('[API] Error en /get-qr:', error);
        res.status(500).json({
            status: 'error',
            qr: null,
            message: 'Error obteniendo estado: ' + error.message
        });
    }
});

/**
 * POST /stop-whatsapp
 * Detiene el bot de WhatsApp
 */
app.post('/stop-whatsapp', async (req, res) => {
    try {
        logger.info('[API] Solicitud de detener WhatsApp');

        const status = whatsappService.getStatus();
        
        if (!status.isReady && !status.isInitializing) {
            return res.json({
                success: true,
                message: 'WhatsApp ya está detenido'
            });
        }

        await whatsappService.destroy();

        res.json({
            success: true,
            message: 'WhatsApp detenido exitosamente'
        });

    } catch (error) {
        logger.error('[API] Error en /stop-whatsapp:', error);
        res.status(500).json({
            success: false,
            message: 'Error al detener WhatsApp: ' + error.message
        });
    }
});

/**
 * POST /cleanup-session
 * Limpia la sesión de WhatsApp (fuerza nuevo escaneo de QR)
 */
app.post('/cleanup-session', async (req, res) => {
    try {
        logger.info('[API] Solicitud de limpieza de sesión');

        // Primero detener el cliente si está activo
        const status = whatsappService.getStatus();
        if (status.isReady || status.isInitializing) {
            await whatsappService.destroy();
        }

        // Eliminar carpeta de autenticación
        const fs = require('fs');
        const path = require('path');
        const authPath = path.join(__dirname, '..', '.wwebjs_auth');

        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            logger.info('[API] Carpeta de autenticación eliminada');
        }

        res.json({
            success: true,
            message: 'Sesión limpiada exitosamente. Puedes iniciar WhatsApp nuevamente.'
        });

    } catch (error) {
        logger.error('[API] Error en /cleanup-session:', error);
        res.status(500).json({
            success: false,
            message: 'Error al limpiar sesión: ' + error.message
        });
    }
});

/**
 * GET /status
 * Obtiene el estado general del bot
 */
app.get('/status', async (req, res) => {
    try {
        const status = whatsappService.getStatus();

        res.json({
            success: true,
            whatsapp: {
                connected: status.isReady,
                initializing: status.isInitializing,
                hasQR: status.hasQR,
                role: status.role
            },
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                nodeVersion: process.version
            }
        });

    } catch (error) {
        logger.error('[API] Error en /status:', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado: ' + error.message
        });
    }
});

/**
 * GET /health
 * Endpoint de health check
 */
app.get('/health', async (req, res) => {
    try {
        // Verificar conexión a base de datos de roles
        await dbRoles.query('SELECT 1');
        
        // Verificar conexión a base de datos de inmobiliaria
        await dbInmobiliaria.query('SELECT 1');

        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            databases: {
                roles: 'connected',
                inmobiliaria: 'connected'
            }
        });

    } catch (error) {
        logger.error('[API] Error en /health:', error);
        res.status(503).json({
            success: false,
            status: 'unhealthy',
            message: error.message
        });
    }
});

/**
 * GET /
 * Endpoint raíz
 */
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Bot de WhatsApp Inmobiliaria API',
        version: '1.0.0',
        endpoints: {
            'POST /start-whatsapp': 'Iniciar bot de WhatsApp',
            'GET /get-qr': 'Obtener código QR',
            'POST /stop-whatsapp': 'Detener bot',
            'POST /cleanup-session': 'Limpiar sesión',
            'GET /status': 'Estado del sistema',
            'GET /health': 'Health check'
        }
    });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado'
    });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    logger.error('[API] Error no manejado:', err);
    res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
});

// ==================== INICIAR SERVIDOR ====================

async function startServer() {
    try {
        // Verificar conexiones a base de datos
        logger.info('[SERVER] Verificando conexiones a base de datos...');
        
        await dbRoles.query('SELECT 1');
        logger.info('[SERVER] ✅ Conexión a BD de Roles OK');
        
        await dbInmobiliaria.query('SELECT 1');
        logger.info('[SERVER] ✅ Conexión a BD de Inmobiliaria OK');

        // Iniciar servidor Express
        app.listen(PORT, () => {
            logger.info('='.repeat(50));
            logger.info(`[SERVER] 🚀 Servidor iniciado en puerto ${PORT}`);
            logger.info(`[SERVER] 📡 URL: http://localhost:${PORT}`);
            logger.info(`[SERVER] 🕐 Fecha: ${new Date().toLocaleString()}`);
            logger.info('='.repeat(50));
        });

    } catch (error) {
        logger.error('[SERVER] ❌ Error fatal al iniciar servidor:', error);
        process.exit(1);
    }
}

// Manejo de cierre graceful
process.on('SIGINT', async () => {
    logger.info('[SERVER] Señal SIGINT recibida, cerrando servidor...');
    
    try {
        await whatsappService.destroy();
        logger.info('[SERVER] WhatsApp cerrado correctamente');
    } catch (error) {
        logger.error('[SERVER] Error cerrando WhatsApp:', error);
    }
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('[SERVER] Señal SIGTERM recibida, cerrando servidor...');
    
    try {
        await whatsappService.destroy();
        logger.info('[SERVER] WhatsApp cerrado correctamente');
    } catch (error) {
        logger.error('[SERVER] Error cerrando WhatsApp:', error);
    }
    
    process.exit(0);
});

// Iniciar servidor
startServer();

module.exports = app;