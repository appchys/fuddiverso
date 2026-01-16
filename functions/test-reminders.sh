#!/bin/bash

# Script de prueba para verificar la función de recordatorios
# Este script te ayuda a probar la función localmente antes de desplegar

echo "🧪 Script de Prueba - Sistema de Recordatorios"
echo "=============================================="
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "index.js" ]; then
    echo "❌ Error: Este script debe ejecutarse desde el directorio functions/"
    exit 1
fi

echo "✅ Directorio correcto"
echo ""

# Verificar que las dependencias están instaladas
echo "📦 Verificando dependencias..."
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules no encontrado. Instalando dependencias..."
    npm install
else
    echo "✅ Dependencias instaladas"
fi
echo ""

# Verificar que firebase-tools está instalado
echo "🔧 Verificando Firebase CLI..."
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI no está instalado"
    echo "   Instálalo con: npm install -g firebase-tools"
    exit 1
else
    echo "✅ Firebase CLI instalado"
fi
echo ""

# Mostrar información de la función
echo "📋 Información de la función:"
echo "   Nombre: sendScheduledOrderReminders"
echo "   Tipo: Scheduled (Cloud Scheduler)"
echo "   Frecuencia: Cada 5 minutos"
echo "   Zona horaria: America/Guayaquil"
echo ""

# Preguntar si quiere probar localmente o desplegar
echo "¿Qué deseas hacer?"
echo "1) Probar localmente con emuladores"
echo "2) Desplegar a Firebase"
echo "3) Ver logs de producción"
echo "4) Salir"
echo ""
read -p "Selecciona una opción (1-4): " option

case $option in
    1)
        echo ""
        echo "🚀 Iniciando emuladores de Firebase..."
        echo "   Nota: Las funciones programadas no se ejecutan automáticamente en el emulador"
        echo "   Puedes probar la lógica manualmente desde el shell de funciones"
        echo ""
        firebase emulators:start --only functions
        ;;
    2)
        echo ""
        echo "🚀 Desplegando función a Firebase..."
        read -p "¿Desplegar solo sendScheduledOrderReminders? (s/n): " deploy_single
        if [ "$deploy_single" = "s" ] || [ "$deploy_single" = "S" ]; then
            firebase deploy --only functions:sendScheduledOrderReminders
        else
            firebase deploy --only functions
        fi
        ;;
    3)
        echo ""
        echo "📊 Mostrando logs de producción..."
        echo "   Presiona Ctrl+C para salir"
        echo ""
        firebase functions:log --only sendScheduledOrderReminders
        ;;
    4)
        echo ""
        echo "👋 ¡Hasta luego!"
        exit 0
        ;;
    *)
        echo ""
        echo "❌ Opción inválida"
        exit 1
        ;;
esac
