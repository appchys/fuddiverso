import type { Metadata } from 'next'
import { getBusinessByUsername } from '@/lib/database'

type Props = {
  params: Promise<{ username: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { username } = await params
    const business = await getBusinessByUsername(username)
    
    if (!business) {
      return {
        title: 'Restaurante no encontrado - fuddi.shop',
        description: 'El restaurante que buscas no está disponible.',
      }
    }

    const title = `${business.name} - fuddi.shop`
    const description = business.description || `Ordena deliciosa comida de ${business.name} a través de fuddi.shop. ${business.address ? `Ubicado en ${business.address}.` : ''}`
    // Usar imagen del negocio o una imagen por defecto
    const imageUrl = business.image || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&h=630&fit=crop&crop=center'
    const url = `https://fuddi.shop/${business.username}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        url,
        siteName: 'fuddi.shop',
        images: [
          {
            url: imageUrl,
            width: 1200,
            height: 630,
            alt: `Imagen de perfil de ${business.name}`,
            type: 'image/jpeg',
          }
        ],
        locale: 'es_ES',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [imageUrl],
      },
      robots: {
        index: true,
        follow: true,
      },
      alternates: {
        canonical: url,
      },
      other: {
        // Meta tags específicas para WhatsApp
        'og:image:width': '1200',
        'og:image:height': '630',
        'og:image:type': 'image/jpeg',
        
        // Información adicional del negocio
        'business:contact_data:street_address': business.address || '',
        'business:contact_data:phone_number': business.phone || '',
        'business:contact_data:email': business.email || '',
        
        // Additional meta tags for better sharing
        'og:site_name': 'fuddi.shop',
        'og:type': 'restaurant',
        'fb:app_id': 'fuddi_shop_app',
        
        // WhatsApp specific meta tags
        'whatsapp:title': title,
        'whatsapp:description': description,
        'whatsapp:image': imageUrl,
        
        // Schema.org structured data será manejado por el componente
        'application-name': 'fuddi.shop',
        'apple-mobile-web-app-title': title,
        'theme-color': '#ef4444', // Red-500 de Tailwind
      }
    }
  } catch (error) {
    console.error('Error generating metadata for business:', error)
    return {
      title: 'Error - fuddi.shop',
      description: 'Hubo un error al cargar la información del restaurante.',
    }
  }
}

export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
