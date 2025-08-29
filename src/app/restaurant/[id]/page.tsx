'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getBusiness, getProductsByBusiness } from '@/lib/database'
import Link from 'next/link'

// Componente para mostrar productos
function ProductCard({ product, onAddToCart }: { product: any, onAddToCart: (item: any) => void }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 flex flex-col">
      {product.image && (
        <img src={product.image} alt={product.name} className="w-full h-48 object-cover rounded-lg mb-4" />
      )}
      <h4 className="text-lg font-bold text-gray-900 mb-2">{product.name}</h4>
      <p className="text-gray-600 mb-3 flex-grow">{product.description}</p>
      <div className="flex items-center justify-between">
        {/* Mostrar precio */}
        {product.variants && product.variants.length > 0 ? (
          <span className="text-red-600 font-bold text-xl">
            Desde ${Math.min(...product.variants.filter((v: any) => v.isAvailable).map((v: any) => v.price)).toFixed(2)}
          </span>
        ) : (
          <span className="text-red-600 font-bold text-xl">${product.price.toFixed(2)}</span>
        )}
        
        <button
          onClick={() => onAddToCart(product)}
          disabled={!product.isAvailable}
          className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
            product.isAvailable 
              ? 'bg-red-600 text-white hover:bg-red-700' 
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {product.isAvailable ? 'Agregar' : 'No Disponible'}
        </button>
      </div>
    </div>
  );
}

// Modal para seleccionar variantes
function VariantModal({ product, isOpen, onClose, onAddToCart }: {
  product: any;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (item: any) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />
        
        <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Selecciona una opción</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mb-4">
            <h4 className="font-semibold text-gray-900">{product?.name}</h4>
            <p className="text-sm text-gray-600 mt-1">{product?.description}</p>
          </div>

          <div className="space-y-3 mb-6">
            {product?.variants?.map((variant: any) => (
              <div
                key={variant.id}
                className={`border rounded-lg p-3 cursor-pointer transition-all ${
                  variant.isAvailable
                    ? selectedVariant?.id === variant.id
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                    : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                }`}
                onClick={() => variant.isAvailable && setSelectedVariant(variant)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h5 className="font-medium text-gray-900">{variant.name}</h5>
                    {variant.description && (
                      <p className="text-sm text-gray-600">{variant.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-red-600 font-bold">${variant.price.toFixed(2)}</span>
                    {!variant.isAvailable && (
                      <p className="text-xs text-gray-500">No disponible</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (selectedVariant) {
                  onAddToCart({
                    id: `${product.id}-${selectedVariant.id}`,
                    name: `${product.name} - ${selectedVariant.name}`,
                    price: selectedVariant.price,
                    image: product.image,
                    description: selectedVariant.description || product.description,
                    businessId: product.businessId,
                    productId: product.id,
                    variantId: selectedVariant.id
                  });
                  onClose();
                  setSelectedVariant(null);
                }
              }}
              disabled={!selectedVariant}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md ${
                selectedVariant
                  ? 'text-white bg-red-600 hover:bg-red-700'
                  : 'text-gray-400 bg-gray-200 cursor-not-allowed'
              }`}
            >
              Agregar al carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RestaurantPage() {
  const params = useParams();
  const [cart, setCart] = useState<any[]>([]);
  const [restaurant, setRestaurant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);

  useEffect(() => {
    const fetchRestaurantAndMenu = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getBusiness(params.id as string);
        if (data) {
          setRestaurant(data);
          // Obtener productos reales del restaurante
          const products = await getProductsByBusiness(params.id as string);
          setMenu(products);
        } else {
          setError('Restaurante no encontrado');
        }
      } catch (err) {
        setError('Error al cargar el restaurante');
      } finally {
        setLoading(false);
      }
    };
    if (params.id) fetchRestaurantAndMenu();
    // Cargar carrito desde localStorage
    try {
      const stored = localStorage.getItem('cart')
      if (stored) {
        const parsed = JSON.parse(stored)
        // Si el carrito pertenece a otro negocio, ignorarlo
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (parsed[0].businessId === params.id) {
            setCart(parsed)
          } else {
            // limpiar carrito local para este restaurante
            setCart([])
          }
        }
      }
    } catch (e) {
      console.error('Error loading cart from localStorage', e)
    }
  }, [params.id]);


  const addToCart = (product: any) => {
    // Si el producto tiene variantes, abrir modal
    if (product.variants && product.variants.length > 0) {
      setSelectedProduct(product)
      setIsVariantModalOpen(true)
      return
    }

    // Si no tiene variantes, agregar directamente
    const cartItem = {
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      description: product.description,
      businessId: params.id
    }

    const existingItem = cart.find(item => item.id === cartItem.id)

    let newCart
    if (existingItem) {
      newCart = cart.map(item => 
        item.id === cartItem.id 
          ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * cartItem.price }
          : item
      )
    } else {
      newCart = [...cart, { ...cartItem, quantity: 1, subtotal: cartItem.price }]
    }
    setCart(newCart)
    try { localStorage.setItem('cart', JSON.stringify(newCart)) } catch (e) { console.error(e) }
  }

  const addVariantToCart = (product: any) => {
    const itemWithBusiness = { ...product, businessId: params.id }
    const existingItem = cart.find(cartItem => cartItem.id === itemWithBusiness.id)

    let newCart
    if (existingItem) {
      newCart = cart.map(cartItem => 
        cartItem.id === itemWithBusiness.id 
          ? { ...cartItem, quantity: cartItem.quantity + 1, subtotal: (cartItem.quantity + 1) * itemWithBusiness.price }
          : cartItem
      )
    } else {
      newCart = [...cart, { ...itemWithBusiness, quantity: 1, subtotal: itemWithBusiness.price }]
    }
    setCart(newCart)
    try { localStorage.setItem('cart', JSON.stringify(newCart)) } catch (e) { console.error(e) }
  }

  const removeFromCart = (itemId: string) => {
    const existingItem = cart.find(cartItem => cartItem.id === itemId)
    
    if (existingItem && existingItem.quantity > 1) {
      const newCart = cart.map(cartItem => 
        cartItem.id === itemId 
          ? { ...cartItem, quantity: cartItem.quantity - 1, subtotal: (cartItem.quantity - 1) * cartItem.price }
          : cartItem
      )
      setCart(newCart)
      try { localStorage.setItem('cart', JSON.stringify(newCart)) } catch (e) { console.error(e) }
    } else {
      const newCart = cart.filter(cartItem => cartItem.id !== itemId)
      setCart(newCart)
      try { localStorage.setItem('cart', JSON.stringify(newCart)) } catch (e) { console.error(e) }
    }
  }

  const getItemQuantity = (itemId: string) => {
    const item = cart.find(cartItem => cartItem.id === itemId)
    return item ? item.quantity : 0
  }

  const getTotalItems = () => {
    return cart.reduce((total, item) => total + item.quantity, 0)
  }

  const getTotalPrice = () => {
    return cart.reduce((total, item) => total + item.subtotal, 0)
  }

  const getCurrentDaySchedule = () => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date().getDay();
    const dayName = days[today];
    return restaurant?.schedule?.[dayName] || null;
  };

  const isBusinessOpen = () => {
    const schedule = getCurrentDaySchedule();
    if (!schedule || !schedule.isOpen) return false;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [openHour, openMinute] = schedule.open.split(':').map(Number);
    const [closeHour, closeMinute] = schedule.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  };

  const formatSchedule = () => {
    const schedule = getCurrentDaySchedule();
    if (!schedule) return 'Horario no disponible';
    return schedule.isOpen ? `${schedule.open} - ${schedule.close}` : 'Cerrado';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-600">Cargando restaurante...</span>
      </div>
    );
  }
  if (error || !restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-red-600">{error || 'Restaurante no encontrado'}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-gray-600 hover:text-red-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <Link href="/" className="text-2xl font-bold text-red-600">
                Fuddiverso
              </Link>
            </div>
            <Link
              href={`/checkout?businessId=${params.id}`}
              className="relative bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14a2 2 0 002-2V11a2 2 0 00-2-2H7m0 8v2a2 2 0 002 2h2a2 2 0 002-2v-2m-6 0V9a2 2 0 012-2h2a2 2 0 012 2v4"/>
              </svg>
              <span>Carrito ({getTotalItems()})</span>
              {getTotalItems() > 0 && (
                <span className="ml-2">${getTotalPrice()}</span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Restaurant Info */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-2/3">
              <div className="flex items-center mb-4">
                <h1 className="text-3xl font-bold text-gray-900 mr-4">{restaurant.name}</h1>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  isBusinessOpen() ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {isBusinessOpen() ? 'Abierto' : 'Cerrado'}
                </span>
              </div>
              <p className="text-gray-600 mb-4">{restaurant.description}</p>
              
              {/* Categories */}
              {restaurant.categories && restaurant.categories.length > 0 && (
                <div className="mb-4">
                  <div className="flex flex-wrap gap-2">
                    {restaurant.categories.map((category: string, index: number) => (
                      <span key={index} className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm">
                        {category}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatSchedule()}
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {restaurant.address}
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {restaurant.phone}
                </div>
              </div>
            </div>
            
            <div className="md:w-1/3 mt-4 md:mt-0">
              {restaurant.image ? (
                <img 
                  src={restaurant.image} 
                  alt={restaurant.name} 
                  className="w-full h-48 object-cover rounded-lg"
                />
              ) : (
                <div className="bg-gradient-to-br from-red-400 to-orange-400 rounded-lg h-48 flex items-center justify-center">
                  <svg className="w-16 h-16 text-white opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Menú real */}
        <div className="space-y-8">
          {menu.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
              </svg>
              <p className="text-gray-600 text-lg">Este restaurante aún no tiene productos disponibles.</p>
            </div>
          ) : (
            <>
              {/* Agrupar productos por categoría */}
              {Object.entries(
                menu.reduce((acc: any, product: any) => {
                  const category = product.category || 'Sin categoría';
                  if (!acc[category]) acc[category] = [];
                  acc[category].push(product);
                  return acc;
                }, {})
              ).map(([category, products]: [string, any]) => (
                <div key={category} className="mb-12">
                  <h2 className="text-2xl font-bold text-gray-900 mb-6 border-b-2 border-red-200 pb-2">
                    {category}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products.map((product: any) => (
                      <ProductCard 
                        key={product.id}
                        product={product}
                        onAddToCart={addToCart}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Floating Cart Button - Mobile */}
        {getTotalItems() > 0 && (
          <div className="fixed bottom-4 left-4 right-4 md:hidden">
            <Link
              href={`/checkout?businessId=${params.id}`}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold text-center block hover:bg-red-700"
            >
              Ver Carrito ({getTotalItems()}) - ${getTotalPrice()}
            </Link>
          </div>
        )}
      </div>

      {/* Modal de variantes */}
      <VariantModal
        product={selectedProduct}
        isOpen={isVariantModalOpen}
        onClose={() => {
          setIsVariantModalOpen(false)
          setSelectedProduct(null)
        }}
        onAddToCart={addVariantToCart}
      />
    </div>
  )
}
