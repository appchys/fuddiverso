# Instrucciones para desplegar Cloud Functions

## Prerrequisitos

1. Tener Firebase CLI instalado:
   ```bash
   npm install -g firebase-tools
   ```

2. Tener iniciada sesión en Firebase:
   ```bash
   firebase login
   ```

3. Seleccionar el proyecto correcto:
   ```bash
   firebase use --add
   # Selecciona: fuddiverso (o el ID de tu proyecto)
   ```

## Paso 1: Configurar variables de entorno

```bash
cd functions
cp .env.example .env
```

Edita `functions/.env` y completa:
- `EMAIL_USER`: Tu email de Gmail (ej: appchys.ec@gmail.com)
- `EMAIL_PASS`: Tu contraseña de aplicación de Gmail

**⚠️ Importante:** Para obtener la contraseña de aplicación:
1. Ve a https://myaccount.google.com/apppasswords
2. Selecciona: Mail → Windows Computer
3. Copia la contraseña generada
4. Pégala en `functions/.env` como `EMAIL_PASS`

## Paso 2: Instalar dependencias

```bash
cd functions
npm install --legacy-peer-deps
```

## Paso 3: Probar localmente (Opcional)

```bash
# Desde la raíz del proyecto
firebase emulators:start

# Esto abrirá:
# - Emulator UI: http://localhost:4000
# - Firestore: http://localhost:8080
# - Functions: http://localhost:5001
```

Para crear órdenes de prueba:
1. Ve a Firestore Emulator en http://localhost:4000
2. Crea un documento en la colección `orders` con la estructura correcta
3. La función `sendOrderEmail` se ejecutará automáticamente

## Paso 4: Desplegar a Firebase

```bash
firebase deploy --only functions
```

O solo la función de email:

```bash
firebase deploy --only functions:sendOrderEmail
```

## Monitoreo

Ver logs en tiempo real:

```bash
firebase functions:log
```

## Estructura de Firestore esperada

Para que los emails funcionen correctamente, asegúrate de que:

1. **Colección `businesses`:**
   ```javascript
   {
     id: "businessId",
     email: "negocio@email.com",
     name: "Nombre del Negocio"
   }
   ```

2. **Colección `clients` (Opcional):**
   ```javascript
   {
     id: "clientId",
     nombres: "Nombre Cliente",
     celular: "0912345678"
   }
   ```

3. **Colección `orders`:**
   ```javascript
   {
     businessId: "businessId",
     customer: {
       id: "clientId",
       name: "Nombre Cliente",
       phone: "0912345678"
     },
     items: [...],
     delivery: {...},
     total: 50.00
   }
   ```

## Troubleshooting

### Error: "Cannot find module 'firebase-functions'"
```bash
cd functions
npm install --legacy-peer-deps
```

### Error: "Invalid login" en email
- Verifica EMAIL_USER y EMAIL_PASS
- Usa contraseña de aplicación, no la regular de Gmail

### Las funciones no se disparan
- Asegúrate de que los documentos se crean en la colección `orders`
- Verifica los logs: `firebase functions:log`

### Error de versiones
```bash
firebase deploy --force --only functions
```

## Recursos útiles

- [Firebase Functions Docs](https://firebase.google.com/docs/functions)
- [Gmail App Passwords](https://myaccount.google.com/apppasswords)
- [Firestore Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore)
