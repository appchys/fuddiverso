# 🔗 Rutas Amigables para Tiendas - Implementación

## 📋 Descripción General

Se implementó un sistema de rutas amigables para las tiendas que permite compartir enlaces directos usando el nombre de usuario (username) de cada negocio. Estos enlaces incluyen meta tags optimizadas para WhatsApp y otras redes sociales.

## 🚀 Funcionalidades Implementadas

### 1. **Rutas Amigables**
- **Formato**: `https://fuddiverso.vercel.app/[username]`
- **Ejemplo**: `https://fuddiverso.vercel.app/burguer-palace`
- **Función**: Cada tienda puede ser accedida directamente usando su username único

### 2. **Meta Tags para WhatsApp**
Se implementaron meta tags de OpenGraph optimizadas para la vista previa en WhatsApp:

#### Meta Tags Principales
- `og:title`: Nombre de la tienda + " - Fuddiverso"
- `og:description`: Descripción de la tienda con ubicación
- `og:image`: Imagen de perfil de la tienda (o imagen por defecto)
- `og:url`: URL canónica de la tienda
- `og:type`: "website"
- `og:site_name`: "Fuddiverso"

#### Meta Tags Específicas de WhatsApp
- `whatsapp:title`: Título específico para WhatsApp
- `whatsapp:description`: Descripción específica para WhatsApp
- `whatsapp:image`: Imagen específica para WhatsApp
- `og:rich_attachment`: "true" para mejores previsualizaciones

#### Meta Tags de Twitter
- `twitter:card`: "summary_large_image"
- `twitter:title`: Título para Twitter
- `twitter:description`: Descripción para Twitter
- `twitter:images`: Array de imágenes

### 3. **Structured Data (JSON-LD)**
Se agregó Schema.org structured data para mejorar el SEO y la información que muestran los motores de búsqueda:

```json
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Nombre del Restaurante",
  "description": "Descripción del negocio",
  "image": "URL de la imagen de perfil",
  "telephone": "Número de teléfono",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Dirección completa",
    "addressCountry": "EC"
  },
  "hasDeliveryService": "True",
  "hasOnlineOrdering": "True",
  "potentialAction": {
    "@type": "OrderAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "URL de la tienda"
    }
  }
}
```

## 📁 Archivos Modificados/Creados

### 1. **Layout Dinámico**: `src/app/[username]/layout.tsx`
- Genera metadatos dinámicos basados en el username
- Implementa la función `generateMetadata()` de Next.js
- Maneja errores si la tienda no existe

### 2. **Página de Tienda**: `src/app/[username]/page.tsx` 
- Componente `BusinessStructuredData` para JSON-LD
- Meta tags adicionales en el head
- Mantiene toda la funcionalidad existente de la tienda

### 3. **Base de Datos**: `src/lib/database.ts`
- Función `getBusinessByUsername()` existente para obtener tienda por username

## 🔧 Cómo Funciona

### 1. **Generación de Metadatos**
```typescript
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const business = await getBusinessByUsername(params.username)
  
  if (!business) {
    return { title: 'Restaurante no encontrado - Fuddiverso' }
  }

  return {
    title: `${business.name} - Fuddiverso`,
    description: business.description || `Ordena comida de ${business.name}`,
    openGraph: {
      title: `${business.name} - Fuddiverso`,
      description: business.description,
      images: [business.image || defaultImage],
      url: `https://fuddiverso.vercel.app/${business.username}`
    }
  }
}
```

### 2. **Componente Structured Data**
```typescript
function BusinessStructuredData({ business }: { business: Business }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "name": business.name,
    "description": business.description,
    "image": business.image,
    // ... más propiedades
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  )
}
```

## 📱 Vista Previa en WhatsApp

Cuando se comparte un enlace de tienda en WhatsApp, se mostrará:

1. **Imagen**: Logo/imagen de perfil de la tienda
2. **Título**: "[Nombre de la Tienda] - Fuddiverso"
3. **Descripción**: Descripción del negocio + ubicación
4. **URL**: La ruta amigable completa

### Ejemplo de Vista Previa:
```
🍽️ [Imagen del Restaurante]
Burger Palace - Fuddiverso
Deliciosas hamburguesas artesanales con ingredientes frescos. Ubicado en Av. Principal 123.
fuddiverso.vercel.app/burger-palace
```

## 🎯 Beneficios

### Para los Negocios:
- **Branding**: URLs profesionales y fáciles de recordar
- **Marketing**: Enlaces amigables para compartir en redes sociales
- **SEO**: Mejor posicionamiento en buscadores
- **Profesionalismo**: Presencia web más sólida

### Para los Clientes:
- **Facilidad**: Enlaces fáciles de recordar y compartir
- **Confianza**: URLs profesionales generan más confianza
- **Información**: Vista previa rica en WhatsApp y redes sociales

### Para la Plataforma:
- **SEO**: Mejor indexación por parte de motores de búsqueda
- **Compartición**: Más fácil viralización de las tiendas
- **Analytics**: Mejor tracking de enlaces compartidos
- **Conversión**: Mejores tasas de click desde redes sociales

## 🧪 Testing

### Probar Meta Tags:
1. **Facebook Debugger**: https://developers.facebook.com/tools/debug/
2. **Twitter Card Validator**: https://cards-dev.twitter.com/validator
3. **LinkedIn Post Inspector**: https://www.linkedin.com/post-inspector/
4. **WhatsApp**: Compartir enlace directamente en chat

### URLs de Prueba:
- Local: `http://localhost:3000/[username]`
- Producción: `https://fuddiverso.vercel.app/[username]`

## 🔧 Configuración de Dominio

Para que las meta tags funcionen correctamente en producción, asegúrate de:

1. **Dominio configurado**: El dominio debe estar correctamente configurado en Vercel
2. **HTTPS**: Todas las URLs deben usar HTTPS
3. **Imágenes**: Las imágenes deben ser accesibles públicamente
4. **Cors**: Las imágenes deben permitir acceso desde redes sociales

## 📊 Monitoreo

### Métricas a Seguir:
- **Click-through rate** desde redes sociales
- **Tiempo en página** desde enlaces compartidos
- **Conversiones** desde enlaces amigables
- **Errores 404** en rutas de username

### Herramientas de Analytics:
- Google Analytics con parámetros UTM
- Facebook Analytics
- Métricas nativas de WhatsApp Business (si aplica)

## 🚀 Próximos Pasos

1. **Sitemap dinámico**: Generar sitemap.xml con todas las rutas de tiendas
2. **Imágenes optimizadas**: Implementar API para generar imágenes OG dinámicas
3. **Cache**: Implementar cache para metadatos de tiendas
4. **Redirects**: Manejar cambios de username con redirects 301
5. **Validación**: Validar que los usernames sean únicos y válidos
