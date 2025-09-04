'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone, validateAndNormalizePhone } from '@/lib/validation'
import { getBusiness, getProductsByBusiness, getOrdersByBusiness, updateOrderStatus, updateProduct, deleteProduct, getBusinessesByOwner, uploadImage, updateBusiness, addBusinessAdministrator, removeBusinessAdministrator, updateAdministratorPermissions, getUserBusinessAccess, getBusinessCategories, addCategoryToBusiness, searchClientByPhone, getClientLocations, createOrder, getDeliveryFeeForLocation, FirestoreClient } from '@/lib/database'
import { Business, Product, Order, ProductVariant } from '@/types'
import { auth } from '@/lib/firebase'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'

export default function BusinessDashboard() {
  const router = useRouter()
  const { user, businessId, ownerId, isAuthenticated, logout, setBusinessId } = useBusinessAuth()
  const [business, setBusiness] = useState<Business | null>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'products' | 'orders' | 'profile' | 'admins' | 'manual-order'>('orders')
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(businessId)
  const [userRole, setUserRole] = useState<'owner' | 'admin' | 'manager' | null>(null) // Nuevo estado
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [editedBusiness, setEditedBusiness] = useState<Business | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  
  // Estados para el modal de edición de productos
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
    isAvailable: true,
    image: null as File | null
  })
  const [editVariants, setEditVariants] = useState<ProductVariant[]>([])
  const [editCurrentVariant, setEditCurrentVariant] = useState({
    name: '',
    description: '',
    price: ''
  })
  const [businessCategories, setBusinessCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [showAddAdminModal, setShowAddAdminModal] = useState(false)
  const [newAdminData, setNewAdminData] = useState({
    email: '',
    role: 'admin' as 'admin' | 'manager',
    permissions: {
      manageProducts: true,
      manageOrders: true,
      manageAdmins: false,
      viewReports: true,
      editBusiness: false
    }
  })
  const [addingAdmin, setAddingAdmin] = useState(false)

  // Estados para edición de horarios
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)
  const [editedSchedule, setEditedSchedule] = useState<any>(null)

  // Estados para orden manual
  const [manualOrderData, setManualOrderData] = useState({
    customerPhone: '',
    customerName: '',
    selectedProducts: [] as Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
      variant?: string;
    }>,
    deliveryType: '' as '' | 'delivery' | 'pickup',
    selectedLocation: null as any,
    customerLocations: [] as any[],
    timing: {
      type: 'immediate' as 'immediate' | 'scheduled',
      scheduledDate: '',
      scheduledTime: ''
    },
    payment: {
      method: 'cash' as 'cash' | 'transfer',
      selectedBank: '',
      receiptImageUrl: '',
      paymentStatus: 'pending' as 'pending' | 'validating' | 'paid'
    },
    notes: ''
  })
  const [searchingClient, setSearchingClient] = useState(false)
  const [clientFound, setClientFound] = useState(false)
  const [loadingClientLocations, setLoadingClientLocations] = useState(false)
  const [isProcessingManualOrder, setIsProcessingManualOrder] = useState(false)
  const [manualOrderStep, setManualOrderStep] = useState(1)
  
  // Estados para modal de variantes
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Protección de ruta - redirigir si no está autenticado
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/business/login');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user || !isAuthenticated) return;
    
    const loadBusinesses = async () => {
      try {
        // Obtener acceso completo del usuario (propietario o administrador)
        const businessAccess = await getUserBusinessAccess(
          user.email || '', 
          user.uid
        );
        
        if (!businessAccess.hasAccess) {
          console.warn('[DASHBOARD] Usuario no tiene acceso a ninguna tienda');
          logout();
          router.push('/business/login');
          return;
        }

        // Combinar tiendas propias y administradas
        const allUserBusinesses = [
          ...businessAccess.ownedBusinesses,
          ...businessAccess.adminBusinesses
        ];
        
        // Remover duplicados por si acaso
        const uniqueBusinesses = allUserBusinesses.filter((business, index, self) =>
          index === self.findIndex(b => b.id === business.id)
        );
        
        setBusinesses(uniqueBusinesses);
        
        // Seleccionar tienda (preferencia: del contexto > primera propia > primera administrada)
        let businessToSelect = null;
        
        if (businessId) {
          businessToSelect = uniqueBusinesses.find(b => b.id === businessId);
        }
        
        if (!businessToSelect) {
          // Preferir tiendas propias sobre administradas
          if (businessAccess.ownedBusinesses.length > 0) {
            businessToSelect = businessAccess.ownedBusinesses[0];
          } else {
            businessToSelect = businessAccess.adminBusinesses[0];
          }
        }
        
        if (businessToSelect) {
          setSelectedBusinessId(businessToSelect.id);
          setBusiness(businessToSelect);
          
          // Actualizar el contexto si es diferente
          if (businessToSelect.id !== businessId) {
            setBusinessId(businessToSelect.id);
          }
          
          // Determinar el rol del usuario en esta tienda
          const isOwner = businessAccess.ownedBusinesses.some(b => b.id === businessToSelect.id);
          if (isOwner) {
            setUserRole('owner');
          } else {
            // Buscar el rol como administrador
            const adminRole = businessToSelect.administrators?.find(
              admin => admin.email === user.email
            );
            setUserRole(adminRole?.role || 'admin');
          }
        }
        
      } catch (error) {
        console.error('Error loading businesses:', error);
        router.push('/business/login');
      } finally {
        setLoading(false);
      }
    };

    loadBusinesses();
  }, [router, user, businessId, isAuthenticated, logout, setBusinessId]);

  // Cargar datos específicos cuando se selecciona una tienda
  useEffect(() => {
    if (!selectedBusinessId) return;

    const loadBusinessData = async () => {
      try {
        // Cargar productos
        const productsData = await getProductsByBusiness(selectedBusinessId);
        setProducts(productsData);

        // Cargar categorías del negocio
        const categoriesData = await getBusinessCategories(selectedBusinessId);
        setBusinessCategories(categoriesData);

        // Cargar órdenes
        const ordersData = await getOrdersByBusiness(selectedBusinessId);
        setOrders(ordersData);

        // Actualizar localStorage
        localStorage.setItem('businessId', selectedBusinessId);
      } catch (error) {
        console.error('Error loading business data:', error);
      }
    };

    loadBusinessData();
  }, [selectedBusinessId]);

  const handleBusinessChange = (businessId: string) => {
    const selectedBusiness = businesses.find(b => b.id === businessId);
    if (selectedBusiness) {
      setSelectedBusinessId(businessId);
      setBusiness(selectedBusiness);
      
      // Actualizar el contexto
      setBusinessId(businessId);
      
      // Actualizar el rol del usuario en la nueva tienda
      const isOwner = user && selectedBusiness.ownerId === user.uid;
      if (isOwner) {
        setUserRole('owner');
      } else {
        const adminRole = selectedBusiness.administrators?.find(
          admin => admin.email === user?.email
        );
        setUserRole(adminRole?.role || 'admin');
      }
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
    try {
      await updateOrderStatus(orderId, newStatus)
      // Actualizar estado local
      setOrders(orders.map(order => 
        order.id === orderId ? { ...order, status: newStatus } : order
      ))
    } catch (error) {
      console.error('Error updating order status:', error)
    }
  }

  const handleToggleAvailability = async (productId: string, currentAvailability: boolean) => {
    try {
      await updateProduct(productId, { isAvailable: !currentAvailability })
      setProducts(prev => prev.map(product => 
        product.id === productId ? { ...product, isAvailable: !currentAvailability } : product
      ))
    } catch (error) {
      console.error('Error updating product availability:', error)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      try {
        await deleteProduct(productId)
        setProducts(prev => prev.filter(product => product.id !== productId))
      } catch (error) {
        console.error('Error deleting product:', error)
      }
    }
  }

  // Funciones para editar productos
  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    setEditFormData({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      isAvailable: product.isAvailable,
      image: null
    })
    setEditVariants(product.variants || [])
    setShowEditModal(true)
  }

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProduct || !selectedBusinessId) return

    // Validar formulario
    const newErrors: Record<string, string> = {}
    if (!editFormData.name.trim()) newErrors.name = 'El nombre es requerido'
    if (!editFormData.description.trim()) newErrors.description = 'La descripción es requerida'
    if (!editFormData.price || isNaN(Number(editFormData.price)) || Number(editFormData.price) <= 0) {
      newErrors.price = 'El precio debe ser un número válido mayor a 0'
    }
    if (!editFormData.category) newErrors.category = 'La categoría es requerida'

    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors)
      return
    }

    setUploading(true)
    try {
      let imageUrl = editingProduct.image // Mantener imagen actual por defecto

      // Subir nueva imagen si se seleccionó una
      if (editFormData.image) {
        const timestamp = Date.now()
        const path = `products/${timestamp}_${editFormData.image.name}`
        imageUrl = await uploadImage(editFormData.image, path)
      }

      const updatedData = {
        name: editFormData.name,
        description: editFormData.description,
        price: Number(editFormData.price),
        category: editFormData.category,
        image: imageUrl,
        variants: editVariants.length > 0 ? editVariants : undefined,
        isAvailable: editFormData.isAvailable,
        updatedAt: new Date()
      }

      await updateProduct(editingProduct.id, updatedData)
      
      setProducts(prev => prev.map(product => 
        product.id === editingProduct.id 
          ? { ...product, ...updatedData }
          : product
      ))

      handleCloseEditModal()
      alert('Producto actualizado exitosamente')
    } catch (error) {
      console.error('Error updating product:', error)
      setEditErrors({ submit: 'Error al actualizar el producto' })
    } finally {
      setUploading(false)
    }
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingProduct(null)
    setEditFormData({
      name: '',
      description: '',
      price: '',
      category: '',
      isAvailable: true,
      image: null
    })
    setEditVariants([])
    setEditCurrentVariant({ name: '', description: '', price: '' })
    setEditErrors({})
    setShowNewCategoryForm(false)
    setNewCategory('')
  }

  // Funciones para manejar input del formulario de edición
  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setEditFormData(prev => ({ ...prev, [name]: value }))
    // Limpiar errores al escribir
    if (editErrors[name]) {
      setEditErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditFormData(prev => ({ ...prev, image: file }))
    }
  }

  // Funciones para manejar variantes en edición
  const handleEditVariantChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setEditCurrentVariant(prev => ({ ...prev, [name]: value }))
  }

  const addEditVariant = () => {
    if (!editCurrentVariant.name.trim()) {
      alert('El nombre de la variante es requerido')
      return
    }

    const price = editCurrentVariant.price ? Number(editCurrentVariant.price) : Number(editFormData.price)
    
    if (isNaN(price) || price <= 0) {
      alert('El precio debe ser un número válido mayor a 0')
      return
    }

    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      name: editCurrentVariant.name,
      description: editCurrentVariant.description || '',
      price: price,
      isAvailable: true
    }

    setEditVariants(prev => [...prev, newVariant])
    setEditCurrentVariant({ name: '', description: '', price: '' })
  }

  const removeEditVariant = (variantId: string) => {
    setEditVariants(prev => prev.filter(v => v.id !== variantId))
  }

  // Función para agregar nueva categoría en edición
  const addNewEditCategory = async () => {
    if (!newCategory.trim() || !selectedBusinessId) {
      alert('El nombre de la categoría es requerido')
      return
    }

    try {
      await addCategoryToBusiness(selectedBusinessId, newCategory.trim())
      setBusinessCategories(prev => [...prev, newCategory.trim()])
      setEditFormData(prev => ({ ...prev, category: newCategory.trim() }))
      setShowNewCategoryForm(false)
      setNewCategory('')
    } catch (error) {
      console.error('Error adding category:', error)
      alert('Error al agregar la categoría')
    }
  }

  // Función para subir imagen de portada
  const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !business) return;

    setUploadingCover(true);
    try {
      // Subir imagen a Firebase Storage
      const timestamp = Date.now();
      const path = `businesses/covers/${business.id}_${timestamp}_${file.name}`;
      const imageUrl = await uploadImage(file, path);
      
      // Actualizar el negocio en Firebase
      await updateBusiness(business.id, { coverImage: imageUrl });
      
      // Actualizar estado local
      const updatedBusiness = { ...business, coverImage: imageUrl };
      setBusiness(updatedBusiness);
      
      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b => 
        b.id === business.id ? updatedBusiness : b
      ));
      
      console.log('Imagen de portada subida exitosamente:', imageUrl);
    } catch (error) {
      console.error('Error subiendo imagen de portada:', error);
      alert('Error al subir la imagen de portada. Inténtalo de nuevo.');
    } finally {
      setUploadingCover(false);
    }
  };

  // Función para subir imagen de perfil
  const handleProfileImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !business) return;

    setUploadingProfile(true);
    try {
      // Subir imagen a Firebase Storage
      const timestamp = Date.now();
      const path = `businesses/profiles/${business.id}_${timestamp}_${file.name}`;
      const imageUrl = await uploadImage(file, path);
      
      // Actualizar el negocio en Firebase
      await updateBusiness(business.id, { image: imageUrl });
      
      // Actualizar estado local
      const updatedBusiness = { ...business, image: imageUrl };
      setBusiness(updatedBusiness);
      
      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b => 
        b.id === business.id ? updatedBusiness : b
      ));
      
      console.log('Imagen de perfil subida exitosamente:', imageUrl);
    } catch (error) {
      console.error('Error subiendo imagen de perfil:', error);
      alert('Error al subir la imagen de perfil. Inténtalo de nuevo.');
    } finally {
      setUploadingProfile(false);
    }
  };

  // Función para iniciar edición
  const handleEditProfile = () => {
    setIsEditingProfile(true);
    setEditedBusiness(business ? { ...business } : null);
  };

  // Función para cancelar edición
  const handleCancelEdit = () => {
    setIsEditingProfile(false);
    setEditedBusiness(null);
  };

  // Función para guardar cambios
  const handleSaveProfile = async () => {
    if (!editedBusiness) return;

    try {
      // Actualizar en Firebase
      await updateBusiness(editedBusiness.id, editedBusiness);
      
      // Actualizar estados locales
      setBusiness(editedBusiness);
      setBusinesses(prev => prev.map(b => 
        b.id === editedBusiness.id ? editedBusiness : b
      ));
      
      setIsEditingProfile(false);
      setEditedBusiness(null);
      
      alert('Información actualizada exitosamente');
      console.log('Perfil actualizado exitosamente:', editedBusiness);
    } catch (error) {
      console.error('Error guardando perfil:', error);
      alert('Error al guardar los cambios. Inténtalo de nuevo.');
    }
  };

  // Función para actualizar campo del negocio editado
  const handleBusinessFieldChange = (field: keyof Business, value: any) => {
    if (!editedBusiness) return;
    setEditedBusiness({ ...editedBusiness, [field]: value });
  };

  // Funciones para administradores
  const handleAddAdmin = async () => {
    if (!business || !newAdminData.email.trim()) return;

    setAddingAdmin(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Usuario no autenticado');

      await addBusinessAdministrator(
        business.id,
        newAdminData.email,
        newAdminData.role,
        newAdminData.permissions,
        currentUser.uid
      );

      // Recargar datos del negocio para mostrar el nuevo admin
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b => 
          b.id === business.id ? updatedBusiness : b
        ));
      }

      // Resetear formulario y cerrar modal
      setNewAdminData({
        email: '',
        role: 'admin',
        permissions: {
          manageProducts: true,
          manageOrders: true,
          manageAdmins: false,
          viewReports: true,
          editBusiness: false
        }
      });
      setShowAddAdminModal(false);
      alert('Administrador agregado exitosamente');
    } catch (error: any) {
      console.error('Error adding admin:', error);
      alert(error.message || 'Error al agregar administrador');
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleRemoveAdmin = async (adminEmail: string) => {
    if (!business || !confirm('¿Estás seguro de que quieres remover este administrador?')) return;

    try {
      await removeBusinessAdministrator(business.id, adminEmail);
      
      // Recargar datos del negocio
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b => 
          b.id === business.id ? updatedBusiness : b
        ));
      }
      
      alert('Administrador removido exitosamente');
    } catch (error: any) {
      console.error('Error removing admin:', error);
      alert(error.message || 'Error al remover administrador');
    }
  };

  const handleUpdateAdminPermissions = async (adminEmail: string, newPermissions: any) => {
    if (!business) return;

    try {
      await updateAdministratorPermissions(business.id, adminEmail, newPermissions);
      
      // Recargar datos del negocio
      const updatedBusiness = await getBusiness(business.id);
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setBusinesses(prev => prev.map(b => 
          b.id === business.id ? updatedBusiness : b
        ));
      }
      
      alert('Permisos actualizados exitosamente');
    } catch (error: any) {
      console.error('Error updating permissions:', error);
      alert(error.message || 'Error al actualizar permisos');
    }
  };

  // Funciones para editar horarios
  const handleEditSchedule = () => {
    if (!business) return
    setEditedSchedule({ ...business.schedule })
    setIsEditingSchedule(true)
  }

  const handleScheduleChange = (day: string, field: 'open' | 'close' | 'isOpen', value: string | boolean) => {
    setEditedSchedule((prev: any) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }))
  }

  const handleSaveSchedule = async () => {
    if (!business?.id || !editedSchedule) return

    try {
      await updateBusiness(business.id, { 
        schedule: editedSchedule,
        updatedAt: new Date()
      })
      
      // Actualizar estado local
      const updatedBusiness = { ...business, schedule: editedSchedule }
      setBusiness(updatedBusiness)
      
      // Actualizar en la lista de negocios
      setBusinesses(prev => prev.map(b => 
        b.id === business.id ? updatedBusiness : b
      ))

      setIsEditingSchedule(false)
      alert('Horario actualizado exitosamente')
    } catch (error) {
      console.error('Error updating schedule:', error)
      alert('Error al actualizar el horario')
    }
  }

  const handleCancelScheduleEdit = () => {
    setIsEditingSchedule(false)
    setEditedSchedule(null)
  }

  // Funciones para manejo de orden manual
  const searchClientByPhoneNumber = async () => {
    if (!manualOrderData.customerPhone) return

    setSearchingClient(true)
    try {
      console.log('🔍 Original phone input:', manualOrderData.customerPhone)
      
      const inputPhone = manualOrderData.customerPhone.trim()
      let client = null
      let phoneToSave = inputPhone
      
      // Intento 1: Buscar con el número tal como está ingresado
      console.log('🔍 Attempt 1 - searching with original input:', inputPhone)
      client = await searchClientByPhone(inputPhone)
      
      if (!client) {
        // Intento 2: Buscar con número normalizado
        const normalizedPhone = validateAndNormalizePhone(inputPhone)
        if (normalizedPhone && normalizedPhone !== inputPhone) {
          console.log('🔍 Attempt 2 - searching with normalized phone:', normalizedPhone)
          client = await searchClientByPhone(normalizedPhone)
          if (client) {
            phoneToSave = normalizedPhone
          }
        }
      }
      
      // Intento 3: Si empieza con +593, probar sin el código de país
      if (!client && inputPhone.startsWith('+593')) {
        const withoutCountryCode = '0' + inputPhone.substring(4)
        console.log('🔍 Attempt 3 - searching without country code:', withoutCountryCode)
        client = await searchClientByPhone(withoutCountryCode)
        if (client) {
          phoneToSave = withoutCountryCode
        }
      }
      
      // Intento 4: Si tiene 9 dígitos, agregar 0 al inicio
      if (!client && inputPhone.length === 9 && inputPhone.startsWith('9')) {
        const with0Prefix = '0' + inputPhone
        console.log('🔍 Attempt 4 - searching with 0 prefix:', with0Prefix)
        client = await searchClientByPhone(with0Prefix)
        if (client) {
          phoneToSave = with0Prefix
        }
      }

      console.log('📋 Final search result:', client)
      
      if (client) {
        setManualOrderData(prev => ({
          ...prev,
          customerPhone: phoneToSave,
          customerName: client.nombres || ''
        }))
        setClientFound(true)
        
        console.log('✅ Client found and loaded:', client.nombres)
        
        // Cargar ubicaciones del cliente
        await loadClientLocations(phoneToSave)
      } else {
        setClientFound(false)
        setManualOrderData(prev => ({
          ...prev,
          customerPhone: phoneToSave,
          customerName: '',
          customerLocations: [],
          selectedLocation: null
        }))
        alert('Cliente no encontrado. Puedes crear la orden con un nombre nuevo.')
      }
    } catch (error) {
      console.error('Error searching client:', error)
      alert('Error al buscar cliente')
    } finally {
      setSearchingClient(false)
    }
  }

  const loadClientLocations = async (phone: string) => {
    setLoadingClientLocations(true)
    try {
      const locations = await getClientLocations(phone)
      setManualOrderData(prev => ({
        ...prev,
        customerLocations: locations || []
      }))
    } catch (error) {
      console.error('Error loading client locations:', error)
    } finally {
      setLoadingClientLocations(false)
    }
  }

  const handleAddProductToManualOrder = (product: Product) => {
    const existingProduct = manualOrderData.selectedProducts.find(p => p.id === product.id)
    
    if (existingProduct) {
      setManualOrderData(prev => ({
        ...prev,
        selectedProducts: prev.selectedProducts.map(p => 
          p.id === product.id 
            ? { ...p, quantity: p.quantity + 1 }
            : p
        )
      }))
    } else {
      setManualOrderData(prev => ({
        ...prev,
        selectedProducts: [...prev.selectedProducts, {
          id: product.id,
          name: product.name,
          price: product.price,
          quantity: 1
        }]
      }))
    }
  }

  const handleRemoveProductFromManualOrder = (productId: string) => {
    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: prev.selectedProducts.filter(p => p.id !== productId)
    }))
  }

  const handleUpdateProductQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveProductFromManualOrder(productId)
      return
    }

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: prev.selectedProducts.map(p => 
        p.id === productId 
          ? { ...p, quantity }
          : p
      )
    }))
  }

  const calculateManualOrderTotal = () => {
    const subtotal = manualOrderData.selectedProducts.reduce((sum, product) => 
      sum + (product.price * product.quantity), 0
    )
    
    let deliveryFee = 0
    if (manualOrderData.deliveryType === 'delivery' && manualOrderData.selectedLocation) {
      deliveryFee = parseFloat(manualOrderData.selectedLocation.tarifa || '0')
    }

    return {
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee
    }
  }

  const handleSubmitManualOrder = async () => {
    // Validaciones
    if (!manualOrderData.customerPhone || !manualOrderData.customerName) {
      alert('Completa los datos del cliente')
      return
    }

    if (manualOrderData.selectedProducts.length === 0) {
      alert('Agrega al menos un producto')
      return
    }

    if (!manualOrderData.deliveryType) {
      alert('Selecciona el tipo de entrega')
      return
    }

    if (manualOrderData.deliveryType === 'delivery' && !manualOrderData.selectedLocation) {
      alert('Selecciona una ubicación para delivery')
      return
    }

    setIsProcessingManualOrder(true)
    try {
      const { total } = calculateManualOrderTotal()

      // Preparar timing
      const deliveryTime = manualOrderData.timing.type === 'immediate' 
        ? new Date(Date.now() + 30 * 60000).toISOString() // 30 minutos
        : new Date(`${manualOrderData.timing.scheduledDate}T${manualOrderData.timing.scheduledTime}`).toISOString()

      const orderData = {
        businessId: selectedBusinessId || '',
        items: manualOrderData.selectedProducts.map(product => ({
          productId: product.id,
          name: product.name,
          price: product.price,
          quantity: product.quantity,
          variant: product.variant || undefined
        })),
        customer: {
          name: manualOrderData.customerName,
          phone: manualOrderData.customerPhone
        },
        delivery: {
          type: manualOrderData.deliveryType as 'delivery' | 'pickup',
          references: manualOrderData.deliveryType === 'delivery' ? manualOrderData.selectedLocation?.referencia : undefined
        },
        timing: {
          type: manualOrderData.timing.type,
          scheduledTime: deliveryTime
        },
        payment: {
          method: manualOrderData.payment.method,
          selectedBank: manualOrderData.payment.method === 'transfer' ? manualOrderData.payment.selectedBank : undefined,
          receiptImageUrl: manualOrderData.payment.method === 'transfer' ? manualOrderData.payment.receiptImageUrl : undefined,
          paymentStatus: manualOrderData.payment.paymentStatus
        },
        total,
        status: 'pending' as 'pending',
        updatedAt: new Date(),
        notes: manualOrderData.notes || undefined,
        createdByAdmin: true // Marcar que fue creada por admin
      }

      const orderId = await createOrder(orderData)
      
      // Limpiar formulario
      setManualOrderData({
        customerPhone: '',
        customerName: '',
        selectedProducts: [],
        deliveryType: '',
        selectedLocation: null,
        customerLocations: [],
        timing: {
          type: 'immediate',
          scheduledDate: '',
          scheduledTime: ''
        },
        payment: {
          method: 'cash',
          selectedBank: '',
          receiptImageUrl: '',
          paymentStatus: 'pending'
        },
        notes: ''
      })
      setClientFound(false)
      setManualOrderStep(1)

      // Recargar órdenes
      await loadOrders()

      alert(`¡Orden creada exitosamente! ID: ${orderId}`)
      
    } catch (error) {
      console.error('Error creating manual order:', error)
      alert('Error al crear la orden')
    } finally {
      setIsProcessingManualOrder(false)
    }
  }

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showBusinessDropdown && !target.closest('.business-dropdown-container')) {
        setShowBusinessDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBusinessDropdown]);

  const handleLogout = () => {
    logout()
    router.push('/business/login')
  }

  // Función para categorizar pedidos
  const categorizeOrders = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate >= today && orderDate < tomorrow;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeA - timeB;
    });

    const upcomingOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate >= tomorrow;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeA - timeB;
    });

    const pastOrders = orders.filter(order => {
      const orderDate = new Date(order.timing?.scheduledTime || order.createdAt);
      return orderDate < today;
    }).sort((a, b) => {
      const timeA = new Date(a.timing?.scheduledTime || a.createdAt).getTime();
      const timeB = new Date(b.timing?.scheduledTime || b.createdAt).getTime();
      return timeB - timeA;
    });

    return { todayOrders, upcomingOrders, pastOrders };
  };

  const formatTime = (dateValue: string | Date) => {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    return date.toLocaleTimeString('es-EC', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (dateValue: string | Date) => {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    return date.toLocaleDateString('es-EC', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'preparing': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'ready': return 'bg-green-100 text-green-800 border-green-200';
      case 'completed': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'delivered': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200';
      case 'pending': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'confirmed': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'preparing': return 'Preparando';
      case 'ready': return 'Listo';
      case 'completed': return 'Completado';
      case 'delivered': return 'Entregado';
      case 'cancelled': return 'Cancelado';
      case 'pending': return 'Pendiente';
      case 'confirmed': return 'Confirmado';
      default: return status;
    }
  };

  const OrderCard = ({ order, isToday = false }: { order: Order, isToday?: boolean }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-bold text-lg text-gray-900 mb-1">
            {order.customer?.name || 'Cliente sin nombre'}
          </h3>
          <p className="text-gray-600 text-sm mb-1">
            <i className="bi bi-telephone me-1"></i>{order.customer?.phone || 'Sin teléfono'}
          </p>
          <p className="text-gray-600 text-sm mb-2">
            <i className={`bi ${order.delivery?.type === 'delivery' ? 'bi-truck' : 'bi-shop'} me-1`}></i>
            {order.delivery?.type === 'delivery' ? 'Entrega a domicilio' : 'Recoger en tienda'}
            {order.delivery?.references && (
              <span className="block text-xs text-gray-500 mt-1">
                <i className="bi bi-geo-alt me-1"></i>{order.delivery.references}
              </span>
            )}
          </p>
          {isToday && (
            <p className="text-sm font-medium text-orange-600">
              <i className="bi bi-clock me-1"></i>{formatTime(order.timing?.scheduledTime || order.createdAt)}
            </p>
          )}
          {!isToday && (
            <p className="text-sm text-gray-500">
              📅 {formatDate(order.timing?.scheduledTime || order.createdAt)}
            </p>
          )}
        </div>
        <div className="text-right ml-4">
          <span className="text-2xl font-bold text-emerald-600">
            ${order.total?.toFixed(2) || '0.00'}
          </span>
          <div className="mt-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}>
              {getStatusText(order.status)}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium text-gray-900 mb-3">Productos:</h4>
        <div className="space-y-2">
          {order.items?.map((item: any, index) => (
            <div key={index} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <span className="font-medium text-gray-900">
                  {item.quantity}x {item.name || item.product?.name || 'Producto sin nombre'}
                </span>
                {(item.description || item.product?.description) && (
                  <p className="text-xs text-gray-500 mt-1">{item.description || item.product?.description}</p>
                )}
              </div>
              <span className="font-bold text-gray-900 ml-4">
                ${((item.price || item.product?.price || 0) * (item.quantity || 1)).toFixed(2)}
              </span>
            </div>
          )) || (
            <div className="text-sm text-gray-500 italic">No hay productos</div>
          )}
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={order.status}
            onChange={(e) => handleStatusChange(order.id, e.target.value as Order['status'])}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
          >
            <option value="pending">🕐 Pendiente</option>
            <option value="confirmed">✅ Confirmado</option>
            <option value="preparing">👨‍🍳 Preparando</option>
            <option value="ready">🔔 Listo</option>
            <option value="delivered">📦 Entregado</option>
            <option value="cancelled">❌ Cancelado</option>
          </select>
          
          <div className="flex gap-2">
            <span className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded">
              💳 {order.payment?.method === 'cash' ? 'Efectivo' : 'Tarjeta'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-600"></div>
          <p className="mt-4 text-gray-600">Cargando dashboard...</p>
        </div>
      </div>
    )
  }

  if (!business) {
    console.warn('[DASHBOARD] No se pudo cargar la información del negocio. businessId:', localStorage.getItem('businessId'));
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No se pudo cargar la información del negocio</p>
          <button 
            onClick={() => router.push('/business/login')}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg"
          >
            Volver al Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3 sm:py-4">
            <div className="flex items-center space-x-3 sm:space-x-6">
              <Link href="/" className="text-xl sm:text-2xl font-bold text-red-600">
                fuddi.shop
              </Link>
              <span className="hidden sm:inline text-gray-600">Dashboard</span>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* Selector de Tiendas con imagen */}
              <div className="relative business-dropdown-container">
                <button
                  onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
                  className="flex items-center space-x-2 sm:space-x-3 bg-gray-50 hover:bg-gray-100 px-2 sm:px-3 py-2 rounded-lg transition-colors"
                >
                  {/* Imagen de perfil de la tienda */}
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                    {business?.image ? (
                      <img
                        src={business.image}
                        alt={business.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <i className="bi bi-shop text-gray-400 text-xs sm:text-sm"></i>
                      </div>
                    )}
                  </div>
                  
                  <div className="hidden sm:flex items-center space-x-2">
                    <div className="flex flex-col">
                      <span className="text-gray-700 font-medium">
                        {business?.name || 'Cargando...'}
                      </span>
                      {userRole && (
                        <span className="text-xs text-gray-500">
                          {userRole === 'owner' ? 'Propietario' : 
                           userRole === 'admin' ? 'Administrador' : 'Gerente'}
                        </span>
                      )}
                    </div>
                    <i className={`bi bi-chevron-down text-gray-500 text-xs transition-transform ${
                      showBusinessDropdown ? 'rotate-180' : ''
                    }`}></i>
                  </div>
                  
                  {/* Solo flecha en móvil */}
                  <i className={`sm:hidden bi bi-chevron-down text-gray-500 text-xs transition-transform ${
                    showBusinessDropdown ? 'rotate-180' : ''
                  }`}></i>
                </button>

                {/* Dropdown */}
                {showBusinessDropdown && (
                  <div className="absolute right-0 mt-2 w-64 sm:w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-10">
                    {/* Tiendas existentes */}
                    {businesses.map((biz) => {
                      // Determinar el rol del usuario en esta tienda
                      const user = auth.currentUser;
                      const isOwner = user && biz.ownerId === user.uid;
                      const adminRole = biz.administrators?.find(
                        admin => admin.email === user?.email
                      );
                      const role = isOwner ? 'owner' : (adminRole?.role || 'admin');
                      
                      return (
                        <button
                          key={biz.id}
                          onClick={() => handleBusinessChange(biz.id)}
                          className={`w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                            selectedBusinessId === biz.id ? 'bg-red-50 border-r-2 border-red-500' : ''
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                            {biz.image ? (
                              <img
                                src={biz.image}
                                alt={biz.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <i className="bi bi-shop text-gray-400 text-sm"></i>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{biz.name}</p>
                            <div className="flex items-center space-x-2">
                              <p className="text-sm text-gray-500 truncate">@{biz.username}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                role === 'owner' 
                                  ? 'bg-red-100 text-red-700' 
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {role === 'owner' ? 'Propietario' : 
                                 role === 'admin' ? 'Admin' : 'Gerente'}
                              </span>
                            </div>
                          </div>
                          {selectedBusinessId === biz.id && (
                            <i className="bi bi-check-circle-fill text-red-500 flex-shrink-0"></i>
                          )}
                        </button>
                      );
                    })}
                    
                    {/* Separador */}
                    {businesses.length > 0 && (
                      <hr className="my-2 border-gray-200" />
                    )}
                    
                    {/* Crear nueva tienda */}
                    <button 
                      onClick={() => {
                        setShowBusinessDropdown(false);
                        router.push('/business/register');
                      }}
                      className="w-full flex items-center space-x-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors text-red-600"
                    >
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <i className="bi bi-plus text-red-600"></i>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">Crear Nueva Tienda</p>
                        <p className="text-sm text-gray-500">Agregar otra tienda</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleLogout}
                className="bg-gray-100 text-gray-700 px-2 sm:px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-box-arrow-right sm:me-2"></i>
                <span className="hidden sm:inline">Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Navigation Tabs */}
        <div className="border-b border-gray-200 mb-6 sm:mb-8">
          <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto">
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'orders'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-clipboard-check me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Pedidos ({orders.length})</span>
              <span className="sm:hidden">Pedidos</span>
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'products'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-box-seam me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Productos ({products.length})</span>
              <span className="sm:hidden">Productos</span>
            </button>
            <button
              onClick={() => setActiveTab('manual-order')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'manual-order'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-plus-circle me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Crear Pedido</span>
              <span className="sm:hidden">Crear</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'profile'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-shop me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Perfil</span>
              <span className="sm:hidden">Perfil</span>
            </button>
            <button
              onClick={() => setActiveTab('admins')}
              className={`py-2 px-1 sm:px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeTab === 'admins'
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <i className="bi bi-people me-1 sm:me-2"></i>
              <span className="hidden sm:inline">Administradores</span>
              <span className="sm:hidden">Admins</span>
            </button>
          </nav>
        </div>

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-8">
            {(() => {
              const { todayOrders, upcomingOrders, pastOrders } = categorizeOrders();
              
              return (
                <>
                  {/* Pedidos de Hoy */}
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">
                        <i className="bi bi-calendar-check me-2"></i>Pedidos de Hoy
                      </h2>
                      <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                        {todayOrders.length} pedidos
                      </span>
                    </div>
                    
                    {todayOrders.length === 0 ? (
                      <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
                        <div className="text-6xl mb-4">📅</div>
                        <p className="text-gray-600 text-lg">No tienes pedidos para hoy</p>
                        <p className="text-gray-500 text-sm mt-2">Los nuevos pedidos aparecerán aquí</p>
                      </div>
                    ) : (
                      <div className="grid gap-6">
                        {todayOrders.map((order) => (
                          <OrderCard key={order.id} order={order} isToday={true} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pedidos Próximos */}
                  {upcomingOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">
                          <i className="bi bi-clock me-2"></i>Pedidos Próximos
                        </h2>
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                          {upcomingOrders.length} pedidos
                        </span>
                      </div>
                      
                      <div className="grid gap-6">
                        {upcomingOrders.map((order) => (
                          <OrderCard key={order.id} order={order} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Historial */}
                  {pastOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        <h2 className="text-2xl font-bold text-gray-900">
                          <i className="bi bi-journal-text me-2"></i>Historial de Pedidos
                        </h2>
                        <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-medium">
                          {pastOrders.length} pedidos
                        </span>
                      </div>
                      
                      <div className="grid gap-6">
                        {pastOrders.slice(0, 10).map((order) => (
                          <OrderCard key={order.id} order={order} />
                        ))}
                      </div>
                      
                      {pastOrders.length > 10 && (
                        <div className="text-center mt-6">
                          <p className="text-gray-500">Mostrando los últimos 10 pedidos</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                <i className="bi bi-box-seam me-2"></i>Mis Productos
              </h2>
              <Link
                href="/business/products/add"
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                <i className="bi bi-plus-lg me-2"></i>Agregar Producto
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                  <i className="bi bi-box-seam text-gray-400 text-2xl"></i>
                </div>
                <p className="text-gray-600 mb-4 text-lg">Aún no tienes productos registrados</p>
                <Link
                  href="/business/products/add"
                  className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
                >
                  <i className="bi bi-plus-lg me-2"></i>Agregar Primer Producto
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => (
                  <div key={product.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                    {/* Imagen o espacio gris */}
                    <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <i className="bi bi-image text-gray-400 text-4xl"></i>
                      )}
                    </div>
                    
                    <div className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-semibold text-lg text-gray-900 flex-1">
                          {product.name}
                        </h3>
                        <div className="flex space-x-1 ml-2">
                          {/* Botón Editar */}
                          <button
                            onClick={() => handleEditProduct(product)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Editar producto"
                          >
                            <i className="bi bi-pencil text-sm"></i>
                          </button>
                          
                          {/* Botón Ocultar/Mostrar */}
                          <button
                            onClick={() => handleToggleAvailability(product.id, product.isAvailable)}
                            className={`p-1.5 rounded transition-colors ${
                              product.isAvailable
                                ? 'text-orange-600 hover:bg-orange-50'
                                : 'text-green-600 hover:bg-green-50'
                            }`}
                            title={product.isAvailable ? 'Ocultar producto' : 'Mostrar producto'}
                          >
                            <i className={`bi ${product.isAvailable ? 'bi-eye-slash' : 'bi-eye'} text-sm`}></i>
                          </button>
                          
                          {/* Botón Eliminar */}
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Eliminar producto"
                          >
                            <i className="bi bi-trash text-sm"></i>
                          </button>
                        </div>
                      </div>
                      
                      <p className="text-gray-600 text-sm mb-3 line-clamp-2">{product.description}</p>
                      
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-red-600 font-bold text-xl">
                          ${product.price.toFixed(2)}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          product.isAvailable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          <i className={`bi ${product.isAvailable ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                          {product.isAvailable ? 'Disponible' : 'No disponible'}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          <i className="bi bi-tag me-1"></i>{product.category}
                        </span>
                        
                        {/* Mostrar número de variantes si existen */}
                        {product.variants && product.variants.length > 0 && (
                          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            <i className="bi bi-collection me-1"></i>{product.variants.length} variantes
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Manual Order Tab */}
        {activeTab === 'manual-order' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                <i className="bi bi-plus-circle me-2"></i>Crear Pedido Manual
              </h2>
              <button
                onClick={() => {
                  // Resetear formulario
                  setManualOrderData({
                    customerPhone: '',
                    customerName: '',
                    selectedProducts: [],
                    deliveryType: '',
                    selectedLocation: null,
                    customerLocations: [],
                    timing: {
                      type: 'immediate',
                      scheduledDate: '',
                      scheduledTime: ''
                    },
                    payment: {
                      method: 'cash',
                      selectedBank: '',
                      receiptImageUrl: '',
                      paymentStatus: 'pending'
                    },
                    notes: ''
                  })
                  setClientFound(false)
                  setManualOrderStep(1)
                }}
                className="text-gray-600 hover:text-gray-800"
              >
                <i className="bi bi-arrow-clockwise me-1"></i>Limpiar Formulario
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Columna 1: Información del Cliente */}
              <div className="xl:col-span-1">
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">
                    <i className="bi bi-person me-2"></i>Cliente
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Teléfono
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={manualOrderData.customerPhone}
                          onChange={(e) => setManualOrderData(prev => ({
                            ...prev,
                            customerPhone: e.target.value
                          }))}
                          placeholder="0987654321"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <button
                          onClick={searchClientByPhoneNumber}
                          disabled={searchingClient || !manualOrderData.customerPhone}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {searchingClient ? (
                            <i className="bi bi-hourglass-split"></i>
                          ) : (
                            <i className="bi bi-search"></i>
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Nombre
                      </label>
                      <input
                        type="text"
                        value={manualOrderData.customerName}
                        onChange={(e) => setManualOrderData(prev => ({
                          ...prev,
                          customerName: e.target.value
                        }))}
                        placeholder="Nombre del cliente"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    {clientFound && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center text-green-800">
                          <i className="bi bi-check-circle me-2"></i>
                          <span className="text-sm font-medium">Cliente encontrado</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tipo de Entrega */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">
                    <i className="bi bi-truck me-2"></i>Entrega
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setManualOrderData(prev => ({
                          ...prev,
                          deliveryType: 'pickup'
                        }))}
                        className={`p-3 border-2 rounded-lg text-center ${
                          manualOrderData.deliveryType === 'pickup'
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <i className="bi bi-shop text-xl mb-1 block"></i>
                        <span className="text-sm font-medium">Pickup</span>
                      </button>
                      
                      <button
                        onClick={() => setManualOrderData(prev => ({
                          ...prev,
                          deliveryType: 'delivery'
                        }))}
                        className={`p-3 border-2 rounded-lg text-center ${
                          manualOrderData.deliveryType === 'delivery'
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <i className="bi bi-truck text-xl mb-1 block"></i>
                        <span className="text-sm font-medium">Delivery</span>
                      </button>
                    </div>

                    {/* Ubicaciones para delivery */}
                    {manualOrderData.deliveryType === 'delivery' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Ubicación
                        </label>
                        
                        {loadingClientLocations ? (
                          <div className="text-center py-3 text-gray-500">
                            <i className="bi bi-hourglass-split"></i> Cargando...
                          </div>
                        ) : manualOrderData.customerLocations.length > 0 ? (
                          <div className="space-y-2">
                            {manualOrderData.customerLocations.map((location, index) => (
                              <button
                                key={index}
                                onClick={() => setManualOrderData(prev => ({
                                  ...prev,
                                  selectedLocation: location
                                }))}
                                className={`w-full p-3 border rounded-lg text-left text-sm ${
                                  manualOrderData.selectedLocation === location
                                    ? 'border-red-500 bg-red-50'
                                    : 'border-gray-300 hover:border-gray-400'
                                }`}
                              >
                                <div className="flex justify-between items-center">
                                  <div className="font-medium">{location.referencia}</div>
                                  <div className="text-red-600 font-bold">+${location.tarifa}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-3 text-gray-500 text-sm">
                            No hay ubicaciones guardadas
                          </div>
                        )}
                      </div>
                    )}

                    {/* Horario */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Horario
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setManualOrderData(prev => ({
                            ...prev,
                            timing: { ...prev.timing, type: 'immediate' }
                          }))}
                          className={`p-3 border-2 rounded-lg text-center ${
                            manualOrderData.timing.type === 'immediate'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <i className="bi bi-lightning text-lg mb-1 block"></i>
                          <span className="text-xs font-medium">Inmediato</span>
                        </button>
                        
                        <button
                          onClick={() => setManualOrderData(prev => ({
                            ...prev,
                            timing: { ...prev.timing, type: 'scheduled' }
                          }))}
                          className={`p-3 border-2 rounded-lg text-center ${
                            manualOrderData.timing.type === 'scheduled'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <i className="bi bi-calendar text-lg mb-1 block"></i>
                          <span className="text-xs font-medium">Programado</span>
                        </button>
                      </div>

                      {manualOrderData.timing.type === 'scheduled' && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <input
                            type="date"
                            value={manualOrderData.timing.scheduledDate}
                            onChange={(e) => setManualOrderData(prev => ({
                              ...prev,
                              timing: { ...prev.timing, scheduledDate: e.target.value }
                            }))}
                            min={new Date().toISOString().split('T')[0]}
                            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                          />
                          <input
                            type="time"
                            value={manualOrderData.timing.scheduledTime}
                            onChange={(e) => setManualOrderData(prev => ({
                              ...prev,
                              timing: { ...prev.timing, scheduledTime: e.target.value }
                            }))}
                            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                          />
                        </div>
                      )}
                    </div>

                    {/* Método de Pago */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Pago
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setManualOrderData(prev => ({
                            ...prev,
                            payment: { ...prev.payment, method: 'cash', paymentStatus: 'paid' }
                          }))}
                          className={`p-3 border-2 rounded-lg text-center ${
                            manualOrderData.payment.method === 'cash'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <i className="bi bi-cash text-lg mb-1 block"></i>
                          <span className="text-xs font-medium">Efectivo</span>
                        </button>
                        
                        <button
                          onClick={() => setManualOrderData(prev => ({
                            ...prev,
                            payment: { ...prev.payment, method: 'transfer', paymentStatus: 'pending' }
                          }))}
                          className={`p-3 border-2 rounded-lg text-center ${
                            manualOrderData.payment.method === 'transfer'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <i className="bi bi-bank text-lg mb-1 block"></i>
                          <span className="text-xs font-medium">Transferencia</span>
                        </button>
                      </div>
                    </div>

                    {/* Notas */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Notas (opcional)
                      </label>
                      <textarea
                        value={manualOrderData.notes}
                        onChange={(e) => setManualOrderData(prev => ({
                          ...prev,
                          notes: e.target.value
                        }))}
                        placeholder="Instrucciones especiales..."
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Columna 2: Lista de Productos */}
              <div className="xl:col-span-1">
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold mb-4">
                    <i className="bi bi-box-seam me-2"></i>Productos Disponibles
                  </h3>
                  
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {products.map((product) => (
                      <div key={product.id} className="border rounded-lg p-3 hover:shadow-sm transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900 text-sm">{product.name}</h4>
                            <p className="text-xs text-gray-600 line-clamp-2">{product.description}</p>
                          </div>
                          <div className="text-right ml-2">
                            {product.variants && product.variants.length > 0 ? (
                              <span className="text-red-600 font-bold text-sm">
                                Desde ${Math.min(...product.variants.filter((v: any) => v.isAvailable).map((v: any) => v.price)).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-red-600 font-bold text-sm">${product.price.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex justify-between items-center">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            product.isAvailable 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {product.isAvailable ? 'Disponible' : 'No disponible'}
                          </span>
                          
                          {product.isAvailable && (
                            <button
                              onClick={() => handleAddProductToManualOrder(product)}
                              className="bg-red-600 text-white px-3 py-1 rounded-md hover:bg-red-700 text-xs"
                            >
                              <i className="bi bi-plus me-1"></i>Agregar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Columna 3: Carrito y Resumen */}
              <div className="xl:col-span-1">
                {/* Productos en el carrito */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h3 className="text-lg font-semibold mb-4">
                    <i className="bi bi-cart me-2"></i>Productos Seleccionados ({manualOrderData.selectedProducts.length})
                  </h3>
                  
                  {manualOrderData.selectedProducts.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <i className="bi bi-cart text-3xl mb-2 block"></i>
                      <p className="text-sm">No hay productos seleccionados</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {manualOrderData.selectedProducts.map((product) => (
                        <div key={product.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <span className="font-medium text-sm">{product.name}</span>
                            <div className="text-xs text-gray-600">${product.price} c/u</div>
                            {product.variant && (
                              <div className="text-xs text-blue-600">• {product.variant}</div>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleUpdateProductQuantity(product.id, product.quantity - 1)}
                                className="w-6 h-6 bg-red-100 text-red-600 rounded-full hover:bg-red-200 text-xs"
                              >
                                <i className="bi bi-dash"></i>
                              </button>
                              <span className="w-6 text-center text-sm">{product.quantity}</span>
                              <button
                                onClick={() => handleUpdateProductQuantity(product.id, product.quantity + 1)}
                                className="w-6 h-6 bg-red-100 text-red-600 rounded-full hover:bg-red-200 text-xs"
                              >
                                <i className="bi bi-plus"></i>
                              </button>
                            </div>
                            
                            <span className="font-bold text-sm min-w-[50px] text-right">
                              ${(product.price * product.quantity).toFixed(2)}
                            </span>
                            
                            <button
                              onClick={() => handleRemoveProductFromManualOrder(product.id)}
                              className="text-red-600 hover:text-red-700 text-xs"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Resumen de costos */}
                {manualOrderData.selectedProducts.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h3 className="text-lg font-semibold mb-4">
                      <i className="bi bi-calculator me-2"></i>Resumen
                    </h3>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span>Productos:</span>
                        <span>${calculateManualOrderTotal().subtotal.toFixed(2)}</span>
                      </div>
                      
                      {manualOrderData.deliveryType === 'delivery' && manualOrderData.selectedLocation && (
                        <div className="flex justify-between text-sm">
                          <span>Delivery:</span>
                          <span>+${calculateManualOrderTotal().deliveryFee.toFixed(2)}</span>
                        </div>
                      )}
                      
                      <div className="border-t pt-3">
                        <div className="flex justify-between font-bold text-lg">
                          <span>Total:</span>
                          <span className="text-red-600">${calculateManualOrderTotal().total.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Botón de crear pedido */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <button
                    onClick={handleSubmitManualOrder}
                    disabled={
                      isProcessingManualOrder ||
                      !manualOrderData.customerPhone ||
                      !manualOrderData.customerName ||
                      manualOrderData.selectedProducts.length === 0 ||
                      !manualOrderData.deliveryType ||
                      (manualOrderData.deliveryType === 'delivery' && !manualOrderData.selectedLocation) ||
                      (manualOrderData.timing.type === 'scheduled' && (!manualOrderData.timing.scheduledDate || !manualOrderData.timing.scheduledTime))
                    }
                    className="w-full bg-red-600 text-white py-3 px-4 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {isProcessingManualOrder ? (
                      <>
                        <i className="bi bi-hourglass-split me-2"></i>
                        Creando pedido...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-circle me-2"></i>
                        Crear Pedido (${calculateManualOrderTotal().total.toFixed(2)})
                      </>
                    )}
                  </button>

                  {/* Validaciones */}
                  <div className="mt-3 text-xs text-gray-500">
                    {!manualOrderData.customerPhone && <div>• Ingresa el teléfono del cliente</div>}
                    {!manualOrderData.customerName && <div>• Ingresa el nombre del cliente</div>}
                    {manualOrderData.selectedProducts.length === 0 && <div>• Selecciona al menos un producto</div>}
                    {!manualOrderData.deliveryType && <div>• Selecciona el tipo de entrega</div>}
                    {manualOrderData.deliveryType === 'delivery' && !manualOrderData.selectedLocation && <div>• Selecciona una ubicación para delivery</div>}
                    {manualOrderData.timing.type === 'scheduled' && (!manualOrderData.timing.scheduledDate || !manualOrderData.timing.scheduledTime) && <div>• Completa la fecha y hora programada</div>}
                  </div>
                </div>
              </div>
            </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
              <i className="bi bi-shop me-2"></i>Información de la Tienda
            </h2>
            
            {/* Imagen de Portada */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden mb-4 sm:mb-6">
              <div className="h-32 sm:h-48 bg-gradient-to-r from-red-400 to-red-600 relative">
                {business.coverImage ? (
                  <img
                    src={business.coverImage}
                    alt="Portada de la tienda"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center text-white">
                      <i className="bi bi-image text-2xl sm:text-4xl mb-1 sm:mb-2 opacity-70"></i>
                      <p className="text-xs sm:text-sm opacity-90">Imagen de portada</p>
                    </div>
                  </div>
                )}
                
                {/* Botón para subir portada */}
                <div className="absolute top-2 right-2 sm:top-4 sm:right-4">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCoverImageUpload}
                    className="hidden"
                    id="cover-upload"
                  />
                  <label
                    htmlFor="cover-upload"
                    className="cursor-pointer bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all inline-flex items-center"
                  >
                    {uploadingCover ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-1"></i>
                        <span className="hidden sm:inline">Subiendo...</span>
                        <span className="sm:hidden">...</span>
                      </>
                    ) : (
                      <>
                        <i className="bi bi-camera me-1"></i>
                        <span className="hidden sm:inline">
                          {business.coverImage ? 'Cambiar Portada' : 'Subir Portada'}
                        </span>
                        <span className="sm:hidden">Portada</span>
                      </>
                    )}
                  </label>
                </div>
              </div>
              
              {/* Imagen de Perfil superpuesta */}
              <div className="relative px-4 sm:px-6 pb-4 sm:pb-6">
                <div className="flex items-end -mt-12 sm:-mt-16">
                  <div className="relative">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-full p-1 shadow-lg">
                      {business.image ? (
                        <img
                          src={business.image}
                          alt={business.name}
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                          <i className="bi bi-shop text-gray-400 text-xl sm:text-2xl"></i>
                        </div>
                      )}
                    </div>
                    
                    {/* Botón para cambiar imagen de perfil */}
                    <div className="absolute -bottom-1 -right-1">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleProfileImageUpload}
                        className="hidden"
                        id="profile-upload"
                      />
                      <label
                        htmlFor="profile-upload"
                        className="cursor-pointer bg-red-600 text-white p-1 sm:p-1.5 rounded-full hover:bg-red-700 transition-colors inline-flex items-center justify-center"
                      >
                        {uploadingProfile ? (
                          <i className="bi bi-arrow-clockwise animate-spin text-xs"></i>
                        ) : (
                          <i className="bi bi-camera text-xs"></i>
                        )}
                      </label>
                    </div>
                  </div>
                  
                  <div className="ml-3 sm:ml-4 flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{business.name}</h3>
                    <p className="text-sm sm:text-base text-gray-600 truncate">@{business.username}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Información de la Tienda */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              {!isEditingProfile ? (
                // Vista de solo lectura
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.name}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-at me-2"></i>Usuario
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">@{business.username}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-envelope me-2"></i>Email
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base break-all">{business.email}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-telephone me-2"></i>Teléfono
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.phone}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-tags me-2"></i>Categorías
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {business.categories && business.categories.length > 0 ? (
                          business.categories.map((category, index) => (
                            <span key={index} className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                              {category}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500 text-sm">Sin categorías</span>
                        )}
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-clock me-2"></i>Estado
                      </label>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        business.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        <i className={`bi ${business.isActive ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                        {business.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-geo-alt me-2"></i>Dirección
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.address}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-card-text me-2"></i>Descripción
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.description}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <i className="bi bi-building me-2"></i>Referencias de Ubicación
                      </label>
                      <p className="text-gray-900 text-sm sm:text-base">{business.references || 'Sin referencias'}</p>
                    </div>
                  </div>
                  
                  <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200">
                    <button 
                      onClick={handleEditProfile}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-pencil me-2"></i>
                      Editar Información
                    </button>
                  </div>
                </>
              ) : (
                // Vista de edición
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.name || ''}
                        onChange={(e) => handleBusinessFieldChange('name', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-at me-2"></i>Usuario
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.username || ''}
                        onChange={(e) => handleBusinessFieldChange('username', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-envelope me-2"></i>Email
                      </label>
                      <input
                        type="email"
                        value={editedBusiness?.email || ''}
                        onChange={(e) => handleBusinessFieldChange('email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-telephone me-2"></i>Teléfono
                      </label>
                      <input
                        type="tel"
                        value={editedBusiness?.phone || ''}
                        onChange={(e) => handleBusinessFieldChange('phone', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-tags me-2"></i>Categorías (separadas por comas)
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.categories?.join(', ') || ''}
                        onChange={(e) => handleBusinessFieldChange('categories', e.target.value.split(',').map(c => c.trim()).filter(c => c))}
                        placeholder="Ej: Comida rápida, Pizza, Italiana"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-clock me-2"></i>Estado de la Tienda
                      </label>
                      <select
                        value={editedBusiness?.isActive ? 'true' : 'false'}
                        onChange={(e) => handleBusinessFieldChange('isActive', e.target.value === 'true')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      >
                        <option value="true">Activa</option>
                        <option value="false">Inactiva</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-geo-alt me-2"></i>Dirección
                      </label>
                      <input
                        type="text"
                        value={editedBusiness?.address || ''}
                        onChange={(e) => handleBusinessFieldChange('address', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-card-text me-2"></i>Descripción
                      </label>
                      <textarea
                        value={editedBusiness?.description || ''}
                        onChange={(e) => handleBusinessFieldChange('description', e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <i className="bi bi-building me-2"></i>Referencias de Ubicación
                      </label>
                      <textarea
                        value={editedBusiness?.references || ''}
                        onChange={(e) => handleBusinessFieldChange('references', e.target.value)}
                        rows={2}
                        placeholder="Ej: Cerca del centro comercial, junto a la farmacia..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                    <button 
                      onClick={handleSaveProfile}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-check-circle me-2"></i>
                      Guardar Cambios
                    </button>
                    <button 
                      onClick={handleCancelEdit}
                      className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm sm:text-base"
                    >
                      <i className="bi bi-x-circle me-2"></i>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Sección de Horarios */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mt-4 sm:mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  <i className="bi bi-clock me-2"></i>Horarios de Atención
                </h3>
                {!isEditingSchedule && (
                  <button
                    onClick={handleEditSchedule}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    <i className="bi bi-pencil me-1"></i>Editar
                  </button>
                )}
              </div>

              {!isEditingSchedule ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(business.schedule).map(([day, schedule]) => {
                    const dayNames: Record<string, string> = {
                      monday: 'Lunes',
                      tuesday: 'Martes', 
                      wednesday: 'Miércoles',
                      thursday: 'Jueves',
                      friday: 'Viernes',
                      saturday: 'Sábado',
                      sunday: 'Domingo'
                    }
                    
                    return (
                      <div key={day} className="bg-gray-50 rounded-lg p-3">
                        <div className="font-medium text-gray-900 mb-1">
                          {dayNames[day]}
                        </div>
                        {schedule.isOpen ? (
                          <div className="text-sm text-gray-600">
                            <span className="text-green-600 font-medium">Abierto</span>
                            <br />
                            {schedule.open} - {schedule.close}
                          </div>
                        ) : (
                          <div className="text-sm text-red-600 font-medium">Cerrado</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(editedSchedule).map(([day, schedule]: [string, any]) => {
                    const dayNames: Record<string, string> = {
                      monday: 'Lunes',
                      tuesday: 'Martes', 
                      wednesday: 'Miércoles',
                      thursday: 'Jueves',
                      friday: 'Viernes',
                      saturday: 'Sábado',
                      sunday: 'Domingo'
                    }
                    
                    return (
                      <div key={day} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-medium text-gray-900">{dayNames[day]}</h4>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={schedule.isOpen}
                              onChange={(e) => handleScheduleChange(day, 'isOpen', e.target.checked)}
                              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                            />
                            <span className="ml-2 text-sm text-gray-700">Abierto</span>
                          </label>
                        </div>
                        
                        {schedule.isOpen && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Hora de apertura
                              </label>
                              <input
                                type="time"
                                value={schedule.open}
                                onChange={(e) => handleScheduleChange(day, 'open', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Hora de cierre
                              </label>
                              <input
                                type="time"
                                value={schedule.close}
                                onChange={(e) => handleScheduleChange(day, 'close', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  
                  <div className="flex space-x-3 pt-4">
                    <button
                      onClick={handleSaveSchedule}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm"
                    >
                      <i className="bi bi-check-lg me-2"></i>Guardar Horarios
                    </button>
                    <button
                      onClick={handleCancelScheduleEdit}
                      className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Administrators Tab */}
        {activeTab === 'admins' && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3 sm:mb-0">
                <i className="bi bi-people me-2"></i>Administradores
              </h2>
              <button
                onClick={() => setShowAddAdminModal(true)}
                className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-person-plus me-2"></i>
                Agregar Administrador
              </button>
            </div>

            {/* Lista de administradores */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">
                  Propietario y Administradores
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Gestiona quién puede administrar tu tienda
                </p>
              </div>

              <div className="divide-y divide-gray-200">
                {/* Propietario */}
                <div className="px-4 sm:px-6 py-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div className="flex items-center mb-3 sm:mb-0">
                      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <i className="bi bi-crown text-red-600"></i>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{business.email}</p>
                        <p className="text-sm text-gray-500">Propietario</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      Todos los permisos
                    </span>
                  </div>
                </div>

                {/* Administradores */}
                {business.administrators && business.administrators.length > 0 ? (
                  business.administrators.map((admin, index) => (
                    <div key={index} className="px-4 sm:px-6 py-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                        <div className="flex items-center mb-3 sm:mb-0">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-person text-blue-600"></i>
                          </div>
                          <div className="ml-3">
                            <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                            <p className="text-sm text-gray-500 capitalize">{admin.role}</p>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {admin.role === 'admin' ? 'Administrador' : 'Gerente'}
                          </span>
                          <button
                            onClick={() => handleRemoveAdmin(admin.email)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            <i className="bi bi-trash me-1"></i>
                            Remover
                          </button>
                        </div>
                      </div>

                      {/* Permisos */}
                      <div className="mt-3 sm:ml-13">
                        <p className="text-xs text-gray-500 mb-2">Permisos:</p>
                        <div className="flex flex-wrap gap-1">
                          {admin.permissions.manageProducts && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                              Productos
                            </span>
                          )}
                          {admin.permissions.manageOrders && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                              Pedidos
                            </span>
                          )}
                          {admin.permissions.viewReports && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                              Reportes
                            </span>
                          )}
                          {admin.permissions.editBusiness && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                              Editar Tienda
                            </span>
                          )}
                          {admin.permissions.manageAdmins && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                              Administradores
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 sm:px-6 py-8 text-center">
                    <i className="bi bi-people text-gray-400 text-4xl mb-4"></i>
                    <p className="text-gray-500">No hay administradores adicionales</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Agrega administradores para que te ayuden a gestionar tu tienda
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal para agregar administrador */}
            {showAddAdminModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-screen overflow-y-auto">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">
                      Agregar Administrador
                    </h3>
                  </div>

                  <div className="px-6 py-4 space-y-4">
                    {/* Email */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email del Usuario
                      </label>
                      <input
                        type="email"
                        value={newAdminData.email}
                        onChange={(e) => setNewAdminData(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        placeholder="usuario@ejemplo.com"
                      />
                    </div>

                    {/* Rol */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Rol
                      </label>
                      <select
                        value={newAdminData.role}
                        onChange={(e) => setNewAdminData(prev => ({ ...prev, role: e.target.value as 'admin' | 'manager' }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      >
                        <option value="admin">Administrador</option>
                        <option value="manager">Gerente</option>
                      </select>
                    </div>

                    {/* Permisos */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Permisos
                      </label>
                      <div className="space-y-2">
                        {[
                          { key: 'manageProducts', label: 'Gestionar Productos' },
                          { key: 'manageOrders', label: 'Gestionar Pedidos' },
                          { key: 'viewReports', label: 'Ver Reportes' },
                          { key: 'editBusiness', label: 'Editar Información de la Tienda' },
                          { key: 'manageAdmins', label: 'Gestionar Administradores' },
                        ].map(({ key, label }) => (
                          <label key={key} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={newAdminData.permissions[key as keyof typeof newAdminData.permissions]}
                              onChange={(e) => setNewAdminData(prev => ({
                                ...prev,
                                permissions: {
                                  ...prev.permissions,
                                  [key]: e.target.checked
                                }
                              }))}
                              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm text-gray-700">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
                    <button
                      onClick={handleAddAdmin}
                      disabled={addingAdmin || !newAdminData.email.trim()}
                      className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {addingAdmin ? (
                        <>
                          <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                          Agregando...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check me-2"></i>
                          Agregar
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowAddAdminModal(false)}
                      disabled={addingAdmin}
                      className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de Edición de Producto */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  <i className="bi bi-pencil me-2"></i>Editar Producto
                </h3>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <form onSubmit={handleUpdateProduct} className="space-y-6">
                {/* Categoría */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Categoría *
                  </label>
                  
                  {!showNewCategoryForm ? (
                    <div className="space-y-2">
                      <select
                        name="category"
                        value={editFormData.category}
                        onChange={handleEditInputChange}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          editErrors.category ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      >
                        <option value="">Selecciona una categoría</option>
                        {businessCategories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      
                      <button
                        type="button"
                        onClick={() => setShowNewCategoryForm(true)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        + Agregar nueva categoría
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 p-4 border border-gray-200 rounded-md bg-gray-50">
                      <h4 className="font-medium text-gray-900">Nueva Categoría</h4>
                      <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Nombre de la categoría"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={addNewEditCategory}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          Agregar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCategoryForm(false)
                            setNewCategory('')
                          }}
                          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {editErrors.category && <p className="text-red-500 text-sm mt-1">{editErrors.category}</p>}
                </div>

                {/* Nombre del producto */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={editFormData.name}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Ej: Hamburguesa Clásica"
                    required
                  />
                  {editErrors.name && <p className="text-red-500 text-sm mt-1">{editErrors.name}</p>}
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descripción *
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    value={editFormData.description}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.description ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Describe tu producto..."
                    required
                  />
                  {editErrors.description && <p className="text-red-500 text-sm mt-1">{editErrors.description}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Precio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Precio Base *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="price"
                        value={editFormData.price}
                        onChange={handleEditInputChange}
                        className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          editErrors.price ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    {editErrors.price && <p className="text-red-500 text-sm mt-1">{editErrors.price}</p>}
                  </div>

                  {/* Imagen */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Imagen del Producto
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleEditImageChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    {editingProduct?.image && (
                      <div className="mt-2">
                        <img 
                          src={editingProduct.image} 
                          alt="Imagen actual" 
                          className="w-16 h-16 object-cover rounded-md"
                        />
                        <p className="text-xs text-gray-500 mt-1">Imagen actual</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Variantes */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Variantes del Producto</h3>
                    <span className="text-sm text-gray-500">Opcional</span>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-md mb-4">
                    <h4 className="font-medium text-gray-900 mb-3">Agregar Nueva Variante</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre de la variante *
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={editCurrentVariant.name}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Ej: Tamaño grande, Con queso extra"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Precio ($ - opcional)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          name="price"
                          value={editCurrentVariant.price}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Dejalo vacío para usar precio base"
                        />
                      </div>
                      
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={addEditVariant}
                          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Agregar Variante
                        </button>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Descripción (opcional)
                      </label>
                      <input
                        type="text"
                        name="description"
                        value={editCurrentVariant.description}
                        onChange={handleEditVariantChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Ej: Con salsa especial"
                      />
                    </div>
                  </div>
                  
                  {/* Lista de variantes */}
                  {editVariants.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-3">Variantes agregadas:</h4>
                      <div className="space-y-2">
                        {editVariants.map((variant) => (
                          <div key={variant.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-4">
                                <span className="font-medium text-gray-900">{variant.name}</span>
                                <span className="text-green-600 font-medium">${variant.price.toFixed(2)}</span>
                                {variant.description && (
                                  <span className="text-gray-500 text-sm">- {variant.description}</span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeEditVariant(variant.id)}
                              className="text-red-600 hover:text-red-700 p-1"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Disponibilidad */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editFormData.isAvailable}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Producto disponible</span>
                  </label>
                </div>

                {/* Errores */}
                {editErrors.submit && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-red-600 text-sm">{editErrors.submit}</p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-lg me-2"></i>
                        Guardar Cambios
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    disabled={uploading}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
