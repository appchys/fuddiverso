const admin = require('firebase-admin');

/**
 * Obtener emails de administradores de un negocio
 */
async function getBusinessAdminEmails(businessId) {
    try {
        const businessDoc = await admin.firestore().collection('businesses').doc(businessId).get();
        if (!businessDoc.exists) return [];

        const data = businessDoc.data();
        const emails = [];

        // El email principal del negocio siempre se incluye (usualmente el del dueño)
        // Pero aquí solo queremos los extras si existen
        if (data.adminEmails && Array.isArray(data.adminEmails)) {
            emails.push(...data.adminEmails);
        }

        // También revisar array de objetos administrators por si acaso
        if (data.administrators && Array.isArray(data.administrators)) {
            data.administrators.forEach(admin => {
                if (admin.email && !emails.includes(admin.email)) {
                    emails.push(admin.email);
                }
            });
        }

        // Filtrar duplicados y emails vacíos
        return [...new Set(emails)].filter(e => e && e.trim().length > 0);
    } catch (error) {
        console.error('Error obteniendo emails de admins:', error);
        return [];
    }
}

module.exports = {
    getBusinessAdminEmails
};
