import type { Metadata } from 'next'
import { getProduct, getProductBySlug, getBusinessByProduct } from '@/lib/database'

type ProductPageParams = {
  params: Promise<{
    username: string
    productSlug: string
  }>
}

export async function generateMetadata({ params }: ProductPageParams): Promise<Metadata> {
  const { username, productSlug } = await params

  try {
    let product = await getProductBySlug(productSlug)

    // Fallback for old IDs
    if (!product) {
      product = await getProduct(productSlug)
    }

    if (!product) {
      return {
        title: 'Producto no encontrado - fuddi.shop',
        description: 'El producto que buscas no está disponible.',
      }
    }

    // Fetch business info to get the store name
    const business = await getBusinessByProduct(product.id)
    const storeName = business?.name || 'fuddi.shop'

    const title = `${product.name} - ${storeName}`

    // Format description based on variants
    let descriptionPrefix = ''
    if (product.variants && product.variants.length > 0) {
      const minPrice = Math.min(...product.variants.map(v => v.price))
      descriptionPrefix = `Desde $${minPrice.toFixed(2)} - `
    } else {
      descriptionPrefix = `$${product.price.toFixed(2)} - `
    }

    const description = `${descriptionPrefix}${product.description || `Descubre ${product.name} en ${storeName}`}`
    const imageUrl = product.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&h=630&fit=crop&crop=center'
    const url = `https://fuddi.shop/${username}/${product.slug || product.id}`

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
            alt: `Imagen de ${product.name}`,
          },
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
        'og:image:width': '1200',
        'og:image:height': '630',
        'og:image:type': 'image/jpeg',
      },
    }
  } catch (error) {
    console.error('Error generating metadata for product page:', error)
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
