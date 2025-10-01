# Script para limpiar el dashboard y usar ProductManagement component

$file = "c:\Users\Lenovo\fuddiverso\src\app\business\dashboard\page.tsx"
$content = Get-Content $file -Raw

Write-Host "Aplicando cambios al dashboard..." -ForegroundColor Yellow

# 1. Reemplazar la sección de Products Tab con el componente ProductManagement
$productsTabPattern = "(?s)(\s+\{/\* Products Tab \*/\}\s+\{activeTab === 'products' && \(\s+<div>.*?</div>\s+\)\})"
$productsTabReplacement = @"

        {/* Products Tab */}
        {activeTab === 'products' && (
          <ProductManagement
            business={business}
            products={products}
            onProductsChange={setProducts}
            businessCategories={businessCategories}
            onCategoriesChange={setBusinessCategories}
          />
        )}
"@

if ($content -match $productsTabPattern) {
    $content = $content -replace $productsTabPattern, $productsTabReplacement
    Write-Host "✓ Reemplazada sección Products Tab" -ForegroundColor Green
} else {
    Write-Host "✗ No se encontró la sección Products Tab" -ForegroundColor Red
}

# 2. Eliminar el Modal de Edición de Producto
$modalPattern = "(?s)\s+\{/\* Modal de Edición de Producto \*/\}\s+\{showEditModal && \(.*?\)\}"
$content = $content -replace $modalPattern, ""
Write-Host "✓ Eliminado Modal de Edición de Producto" -ForegroundColor Green

# Guardar el archivo
$content | Set-Content $file -NoNewline
Write-Host "`n✓ Cambios aplicados exitosamente!" -ForegroundColor Green
Write-Host "Ahora necesitas eliminar manualmente las funciones de productos (líneas 835-1015)" -ForegroundColor Yellow
