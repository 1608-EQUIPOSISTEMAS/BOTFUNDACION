const db = require('../config/database2');
const logger = require('../utils/logger');

/**
 * Crea una nueva conversación en la base de datos
 * @param {object} data - Datos de la conversación
 * @returns {Promise<number>} - ID de la conversación creada
 */
async function createConversation(data) {
    try {
        const { userPhone, userName, campaignId, triggerMessage, matchedKeyword, matchType } = data;
        
        const [result] = await db.query(
            `INSERT INTO bot_conversations 
            (user_phone, user_name, campaign_id, trigger_message, matched_keyword, match_type, status, conversation_started_at)
            VALUES (?, ?, ?, ?, ?, ?, 'INITIATED', NOW())`,
            [userPhone, userName, campaignId, triggerMessage, matchedKeyword, matchType]
        );
        
        const conversationId = result.insertId;
        
        logger.info(`[CONVERSATION] Nueva conversación creada: ID ${conversationId} - Usuario: ${userPhone} - Campaña: ${campaignId}`);
        
        return conversationId;
        
    } catch (error) {
        logger.error('[CONVERSATION] Error creando conversación:', error);
        throw error;
    }
}

/**
 * Actualiza el estado de una conversación
 * @param {number} conversationId - ID de la conversación
 * @param {string} status - Nuevo estado (INITIATED, IN_PROGRESS, COMPLETED, FAILED, CANCELLED)
 * @returns {Promise<void>}
 */
async function updateConversationStatus(conversationId, status) {
    try {
        const validStatuses = ['INITIATED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'];
        
        if (!validStatuses.includes(status)) {
            throw new Error(`Estado inválido: ${status}`);
        }
        
        await db.query(
            `UPDATE bot_conversations 
            SET status = ?,
                conversation_ended_at = CASE WHEN ? IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN NOW() ELSE conversation_ended_at END,
                updated_at = NOW()
            WHERE id = ?`,
            [status, status, conversationId]
        );
        
        logger.info(`[CONVERSATION] Estado actualizado: ID ${conversationId} -> ${status}`);
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error actualizando estado de conversación ${conversationId}:`, error);
        throw error;
    }
}

/**
 * Incrementa el contador de mensajes enviados
 * @param {number} conversationId - ID de la conversación
 * @returns {Promise<void>}
 */
async function incrementMessagesSent(conversationId) {
    try {
        await db.query(
            `UPDATE bot_conversations 
            SET messages_sent = messages_sent + 1,
                last_message_sent_at = NOW(),
                status = 'IN_PROGRESS',
                updated_at = NOW()
            WHERE id = ?`,
            [conversationId]
        );
        
        logger.debug(`[CONVERSATION] Contador de mensajes incrementado: ID ${conversationId}`);
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error incrementando mensajes de conversación ${conversationId}:`, error);
        throw error;
    }
}

/**
 * Verifica si el usuario tiene una conversación activa
 * @param {string} userPhone - Número de teléfono
 * @returns {Promise<object|null>}
 */
async function getActiveConversation(userPhone) {
    try {
        const [conversations] = await db.query(
            `SELECT 
                id,
                campaign_id,
                status,
                messages_sent,
                conversation_started_at
            FROM bot_conversations
            WHERE user_phone = ?
                AND status IN ('INITIATED', 'IN_PROGRESS')
            ORDER BY conversation_started_at DESC
            LIMIT 1`,
            [userPhone]
        );
        
        if (conversations.length === 0) {
            return null;
        }
        
        return conversations[0];
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error obteniendo conversación activa para ${userPhone}:`, error);
        throw error;
    }
}

/**
 * Obtiene los detalles completos de una conversación
 * @param {number} conversationId - ID de la conversación
 * @returns {Promise<object|null>}
 */
async function getConversationById(conversationId) {
    try {
        const [conversations] = await db.query(
            `SELECT 
                bc.*,
                c.name as campaign_name
            FROM bot_conversations bc
            INNER JOIN campaigns c ON bc.campaign_id = c.id
            WHERE bc.id = ?`,
            [conversationId]
        );
        
        if (conversations.length === 0) {
            return null;
        }
        
        return conversations[0];
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error obteniendo conversación ${conversationId}:`, error);
        throw error;
    }
}

/**
 * Finaliza una conversación marcándola como completada
 * @param {number} conversationId - ID de la conversación
 * @returns {Promise<void>}
 */
async function completeConversation(conversationId) {
    try {
        await db.query(
            `UPDATE bot_conversations 
            SET status = 'COMPLETED',
                conversation_ended_at = NOW(),
                updated_at = NOW()
            WHERE id = ?`,
            [conversationId]
        );
        
        logger.info(`[CONVERSATION] Conversación completada: ID ${conversationId}`);
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error completando conversación ${conversationId}:`, error);
        throw error;
    }
}

/**
 * Marca una conversación como fallida
 * @param {number} conversationId - ID de la conversación
 * @param {string} reason - Razón del fallo (opcional)
 * @returns {Promise<void>}
 */
async function failConversation(conversationId, reason = null) {
    try {
        await db.query(
            `UPDATE bot_conversations 
            SET status = 'FAILED',
                conversation_ended_at = NOW(),
                updated_at = NOW(),
                session_metadata = JSON_SET(
                    COALESCE(session_metadata, '{}'),
                    '$.failure_reason',
                    ?
                )
            WHERE id = ?`,
            [reason, conversationId]
        );
        
        logger.error(`[CONVERSATION] Conversación fallida: ID ${conversationId} - Razón: ${reason}`);
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error marcando conversación como fallida ${conversationId}:`, error);
        throw error;
    }
}

/**
 * Obtiene estadísticas de conversaciones por usuario
 * @param {string} userPhone - Número de teléfono
 * @returns {Promise<object>}
 */
async function getUserConversationStats(userPhone) {
    try {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_conversations,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
                MAX(conversation_started_at) as last_conversation
            FROM bot_conversations
            WHERE user_phone = ?`,
            [userPhone]
        );
        
        return stats[0] || {
            total_conversations: 0,
            completed: 0,
            failed: 0,
            last_conversation: null
        };
        
    } catch (error) {
        logger.error(`[CONVERSATION] Error obteniendo estadísticas de ${userPhone}:`, error);
        throw error;
    }
}

module.exports = {
    createConversation,
    updateConversationStatus,
    incrementMessagesSent,
    getActiveConversation,
    getConversationById,
    completeConversation,
    failConversation,
    getUserConversationStats
};