'use client'

import { useState } from 'react'
import { collection, query, getDocs, updateDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export default function MigrateAdminEmailsPage() {
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState<{
        total: number
        updated: number
        skipped: number
        errors: string[]
    } | null>(null)

    const handleMigration = async () => {
        if (!confirm('¿Estás seguro de que quieres ejecutar la migración? Esto actualizará todos los negocios en la base de datos.')) {
            return
        }

        setLoading(true)
        setResults(null)

        try {
            console.log('🔄 Starting adminEmails migration...');
            const migrationResults = {
                total: 0,
                updated: 0,
                skipped: 0,
                errors: [] as string[]
            };

            // Obtener todos los negocios
            const q = query(collection(db, 'businesses'));
            const querySnapshot = await getDocs(q);
            migrationResults.total = querySnapshot.size;

            console.log(`📊 Found ${migrationResults.total} businesses to migrate`);

            // Procesar cada negocio
            for (const docSnapshot of querySnapshot.docs) {
                try {
                    const businessData = docSnapshot.data();
                    const businessId = docSnapshot.id;
                    const administrators = businessData.administrators || [];
                    const currentAdminEmails = businessData.adminEmails || [];

                    // Extraer emails de administrators
                    const newAdminEmails = administrators.map((admin: any) => admin.email).filter(Boolean);

                    // Solo actualizar si hay cambios
                    const needsUpdate =
                        !businessData.adminEmails || // No tiene el campo
                        JSON.stringify(currentAdminEmails.sort()) !== JSON.stringify(newAdminEmails.sort()); // Contenido diferente

                    if (needsUpdate) {
                        await updateDoc(doc(db, 'businesses', businessId), {
                            adminEmails: newAdminEmails
                        });
                        migrationResults.updated++;
                        console.log(`✅ Updated business ${businessId} with ${newAdminEmails.length} admin emails`);
                    } else {
                        migrationResults.skipped++;
                        console.log(`⏭️ Skipped business ${businessId} (already up to date)`);
                    }
                } catch (error: any) {
                    const errorMsg = `Failed to update business ${docSnapshot.id}: ${error.message}`;
                    migrationResults.errors.push(errorMsg);
                    console.error(`❌ ${errorMsg}`);
                }
            }

            console.log(`✅ Migration complete! Updated: ${migrationResults.updated}, Skipped: ${migrationResults.skipped}, Errors: ${migrationResults.errors.length}`);
            setResults(migrationResults)
        } catch (error) {
            console.error('Migration error:', error)
            alert('Error durante la migración. Ver consola para detalles.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-4">
                        Migración: Admin Emails Field
                    </h1>

                    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
                        <h2 className="font-semibold text-blue-900 mb-2">ℹ️ Información</h2>
                        <p className="text-sm text-blue-800">
                            Esta migración poblará el campo <code className="bg-blue-100 px-1 rounded">adminEmails</code> en todos
                            los negocios existentes, extrayendo los emails del array <code className="bg-blue-100 px-1 rounded">administrators</code>.
                        </p>
                        <p className="text-sm text-blue-800 mt-2">
                            <strong>Propósito:</strong> Habilitar queries optimizadas para búsqueda de negocios por administrador,
                            eliminando el escaneo completo de la base de datos.
                        </p>
                    </div>

                    <div className="mb-6">
                        <button
                            onClick={handleMigration}
                            disabled={loading}
                            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                        >
                            {loading ? 'Ejecutando migración...' : 'Ejecutar Migración'}
                        </button>
                    </div>

                    {results && (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-50 border border-green-200 rounded">
                                <h3 className="font-semibold text-green-900 mb-3">✅ Migración Completada</h3>
                                <dl className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <dt className="text-gray-600">Total de negocios:</dt>
                                        <dd className="font-bold text-gray-900">{results.total}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-gray-600">Actualizados:</dt>
                                        <dd className="font-bold text-green-600">{results.updated}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-gray-600">Omitidos (ya actualizados):</dt>
                                        <dd className="font-bold text-blue-600">{results.skipped}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-gray-600">Errores:</dt>
                                        <dd className="font-bold text-red-600">{results.errors.length}</dd>
                                    </div>
                                </dl>
                            </div>

                            {results.errors.length > 0 && (
                                <div className="p-4 bg-red-50 border border-red-200 rounded">
                                    <h3 className="font-semibold text-red-900 mb-2">❌ Errores</h3>
                                    <ul className="text-sm text-red-800 space-y-1">
                                        {results.errors.map((error, index) => (
                                            <li key={index} className="font-mono text-xs">{error}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="p-4 bg-gray-100 border border-gray-300 rounded">
                                <p className="text-sm text-gray-700">
                                    💡 <strong>Próximo paso:</strong> Verifica la consola del navegador para ver los logs detallados
                                    de cada negocio procesado.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
