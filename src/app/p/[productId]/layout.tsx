import type { Metadata } from 'next'
import { getProduct } from '@/lib/database'

type Props = {
    params: Promise<{ productId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    try {
        const { productId } = await params
        const product = await getProduct(productId)

        if (!product) {
            return {
                title: 'Producto no encontrado - fuddi.shop',
                description: 'El producto que buscas no está disponible.',
            }
        }

        const title = product.name
        const description = product.description || `Descubre ${product.name} en fuddi.shop`
        const imageUrl = product.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&h=630&fit=crop&crop=center'
        const url = `https://fuddi.shop/p/${productId}`

        return {
            title: `${title} - fuddi.shop`,
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
                        alt: `Imagen de ${product.name}`,
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

                // Additional meta tags for better sharing
                'og:site_name': 'fuddi.shop',
                'og:type': 'product',

                // WhatsApp specific meta tags
                'whatsapp:title': title,
                'whatsapp:description': description,
                'whatsapp:image': imageUrl,

                'application-name': 'fuddi.shop',
                'apple-mobile-web-app-title': title,
                'theme-color': '#ef4444', // Red-500 de Tailwind
            }
        }
    } catch (error) {
        console.error('Error generating metadata for product:', error)
        return {
            title: 'Error - fuddi.shop',
            description: 'Hubo un error al cargar la información del producto.',
        }
    }
}

export default function ProductLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return children
}
