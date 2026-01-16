# Script de prueba para verificar la función de recordatorios
# Este script te ayuda a probar la función localmente antes de desplegar

Write-Host "🧪 Script de Prueba - Sistema de Recordatorios" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "index.js")) {
    Write-Host "❌ Error: Este script debe ejecutarse desde el directorio functions/" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Directorio correcto" -ForegroundColor Green
Write-Host ""

# Verificar que las dependencias están instaladas
Write-Host "📦 Verificando dependencias..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠️  node_modules no encontrado. Instalando dependencias..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "✅ Dependencias instaladas" -ForegroundColor Green
}
Write-Host ""

# Verificar que firebase-tools está instalado
Write-Host "🔧 Verificando Firebase CLI..." -ForegroundColor Yellow
try {
    $firebaseVersion = firebase --version 2>$null
    Write-Host "✅ Firebase CLI instalado: $firebaseVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Firebase CLI no está instalado" -ForegroundColor Red
    Write-Host "   Instálalo con: npm install -g firebase-tools" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Mostrar información de la función
Write-Host "📋 Información de la función:" -ForegroundColor Cyan
Write-Host "   Nombre: sendScheduledOrderReminders"
Write-Host "   Tipo: Scheduled (Cloud Scheduler)"
Write-Host "   Frecuencia: Cada 5 minutos"
Write-Host "   Zona horaria: America/Guayaquil"
Write-Host ""

# Menú de opciones
Write-Host "¿Qué deseas hacer?" -ForegroundColor Cyan
Write-Host "1) Probar localmente con emuladores"
Write-Host "2) Desplegar a Firebase"
Write-Host "3) Ver logs de producción"
Write-Host "4) Verificar sintaxis del código"
Write-Host "5) Salir"
Write-Host ""

$option = Read-Host "Selecciona una opción (1-5)"

switch ($option) {
    "1" {
        Write-Host ""
        Write-Host "🚀 Iniciando emuladores de Firebase..." -ForegroundColor Green
        Write-Host "   Nota: Las funciones programadas no se ejecutan automáticamente en el emulador" -ForegroundColor Yellow
        Write-Host "   Puedes probar la lógica manualmente desde el shell de funciones" -ForegroundColor Yellow
        Write-Host ""
        firebase emulators:start --only functions
    }
    "2" {
        Write-Host ""
        Write-Host "🚀 Desplegando función a Firebase..." -ForegroundColor Green
        $deploySingle = Read-Host "¿Desplegar solo sendScheduledOrderReminders? (s/n)"
        if ($deploySingle -eq "s" -or $deploySingle -eq "S") {
            firebase deploy --only functions:sendScheduledOrderReminders
        } else {
            firebase deploy --only functions
        }
    }
    "3" {
        Write-Host ""
        Write-Host "📊 Mostrando logs de producción..." -ForegroundColor Cyan
        Write-Host "   Presiona Ctrl+C para salir" -ForegroundColor Yellow
        Write-Host ""
        firebase functions:log --only sendScheduledOrderReminders
    }
    "4" {
        Write-Host ""
        Write-Host "🔍 Verificando sintaxis del código..." -ForegroundColor Yellow
        node -c index.js
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Sintaxis correcta" -ForegroundColor Green
        } else {
            Write-Host "❌ Errores de sintaxis encontrados" -ForegroundColor Red
        }
    }
    "5" {
        Write-Host ""
        Write-Host "👋 ¡Hasta luego!" -ForegroundColor Cyan
        exit 0
    }
    default {
        Write-Host ""
        Write-Host "❌ Opción inválida" -ForegroundColor Red
        exit 1
    }
}
