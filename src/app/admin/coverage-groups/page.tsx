'use client'

import { useState, useEffect } from 'react'
import { 
  getCoverageGroups, 
  createCoverageGroup, 
  updateCoverageGroup, 
  deleteCoverageGroup 
} from '@/lib/database'
import { CoverageGroup } from '@/types'

export default function CoverageGroupsPage() {
  const [groups, setGroups] = useState<CoverageGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<CoverageGroup | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isActive: true
  })
  const [notification, setNotification] = useState<{ show: boolean, message: string, type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })

  useEffect(() => {
    loadGroups()
  }, [])

  const loadGroups = async () => {
    try {
      setLoading(true)
      const data = await getCoverageGroups()
      setGroups(data)
    } catch (error) {
      console.error('Error loading groups:', error)
      showNotification('Error al cargar grupos', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ show: true, message, type })
    setTimeout(() => setNotification(prev => ({ ...prev, show: false })), 3000)
  }

  const handleOpenModal = (group: CoverageGroup | null = null) => {
    if (group) {
      setEditingGroup(group)
      setFormData({
        name: group.name,
        description: group.description || '',
        isActive: group.isActive
      })
    } else {
      setEditingGroup(null)
      setFormData({
        name: '',
        description: '',
        isActive: true
      })
    }
    setIsModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingGroup) {
        await updateCoverageGroup(editingGroup.id, formData)
        showNotification('Grupo actualizado correctamente', 'success')
      } else {
        await createCoverageGroup(formData)
        showNotification('Grupo creado correctamente', 'success')
      }
      setIsModalOpen(false)
      loadGroups()
    } catch (error) {
      console.error('Error saving group:', error)
      showNotification('Error al guardar el grupo', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este grupo?')) {
      try {
        await deleteCoverageGroup(id)
        showNotification('Grupo eliminado', 'success')
        loadGroups()
      } catch (error) {
        console.error('Error deleting group:', error)
        showNotification('Error al eliminar el grupo', 'error')
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 sm:p-10">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Grupos de Cobertura</h1>
            <p className="text-gray-500 font-medium">Gestiona las ciudades o regiones principales.</p>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="bg-red-600 hover:bg-black text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-red-100 flex items-center gap-2"
          >
            <i className="bi bi-plus-lg"></i>
            Nuevo Grupo
          </button>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groups.length === 0 ? (
              <div className="col-span-full py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100">
                <i className="bi bi-tags-fill text-5xl text-gray-200 mb-4 block"></i>
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No hay grupos creados aún</p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-gray-100 group hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-500">
                  <div className="flex justify-between items-start mb-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${group.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
                      <i className="bi bi-tags-fill"></i>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={() => handleOpenModal(group)}
                        className="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center"
                      >
                        <i className="bi bi-pencil"></i>
                      </button>
                      <button
                        onClick={() => handleDelete(group.id)}
                        className="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center"
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                  </div>
                  <h3 className="text-xl font-black text-gray-900 mb-2">{group.name}</h3>
                  <p className="text-gray-500 text-sm mb-4 line-clamp-2 min-h-[40px]">{group.description || 'Sin descripción'}</p>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${group.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                      {group.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
            <div className="bg-white rounded-[3rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
              <form onSubmit={handleSubmit} className="p-8 sm:p-10">
                <header className="flex justify-between items-center mb-8">
                  <h2 className="text-2xl font-black text-gray-900">
                    {editingGroup ? 'Editar Grupo' : 'Nuevo Grupo'}
                  </h2>
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-gray-100 transition-all"
                  >
                    <i className="bi bi-x-lg"></i>
                  </button>
                </header>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre del Grupo (Ciudad)</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ej: Quito"
                      className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-red-500 transition-all font-bold text-gray-900 placeholder:text-gray-300"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Opcional..."
                      rows={3}
                      className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-red-500 transition-all font-bold text-gray-900 placeholder:text-gray-300 resize-none"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${formData.isActive ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-white'}`}>
                        <i className={`bi ${formData.isActive ? 'bi-check-lg' : 'bi-x-lg'}`}></i>
                      </div>
                      <span className="text-sm font-bold text-gray-700 uppercase tracking-widest text-[10px]">Estatus Activo</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                      className={`w-12 h-6 rounded-full transition-all relative ${formData.isActive ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${formData.isActive ? 'left-7' : 'left-1'}`}></div>
                    </button>
                  </div>
                </div>

                <div className="flex gap-4 mt-10">
                  <button
                    type="submit"
                    className="flex-1 px-6 py-5 bg-red-600 hover:bg-black text-white rounded-2xl font-black transition-all shadow-xl shadow-red-200 uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                  >
                    <i className="bi bi-check2-circle text-lg"></i>
                    {editingGroup ? 'Guardar Cambios' : 'Crear Grupo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Notificaciones */}
        {notification.show && (
          <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-8 py-4 rounded-2xl font-black shadow-2xl animate-in slide-in-from-bottom duration-300 flex items-center gap-3 ${notification.type === 'success' ? 'bg-black text-white' : 'bg-red-600 text-white'}`}>
            <i className={`bi ${notification.type === 'success' ? 'bi-check-circle-fill text-emerald-400' : 'bi-exclamation-triangle-fill text-white'}`}></i>
            <span className="uppercase tracking-widest text-[10px]">{notification.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
