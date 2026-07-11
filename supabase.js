const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function normalizeProduct(p) {
  const mainImage = p.image_url || p.image || '';
  const gallery = Array.isArray(p.image_urls) ? p.image_urls : [];
  return {
    ...p,
    id: String(p.id),
    name: p.name || '',
    descripcion: p.description || '',
    precio: Number(p.price) || 0,
    precioDesc: Number(p.preciodesc) || 0,
    stock: Number(p.stock) || 0,
    img: mainImage,
    imgs: [...new Set([mainImage, ...gallery].filter(Boolean))],
    brand: p.brand || 'ISON',
    ref: p.ref || '',
    categoria: p.categoria || '',
    material: p.material || '',
    color: p.color || '',
    garantia: p.garantia || '',
    visible: p.visible !== false
  };
}

function normalizeSale(s) {
  return {
    ...s,
    id: String(s.id),
    productoId: s.productoId == null ? '' : String(s.productoId),
    cantidad: Number(s.cantidad) || 1,
    total: Number(s.total) || 0
  };
}

async function compressImage(file, maxDimension = 1600, quality = 0.78) {
  if (!(file instanceof Blob) || !file.type.startsWith('image/')) {
    throw new Error('Selecciona una imagen válida.');
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('No fue posible optimizar la imagen.')), 'image/webp', quality)
  );
  return new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' });
}

async function uploadImage(file) {
  const optimized = await compressImage(file);
  const digest = await crypto.subtle.digest('SHA-256', await optimized.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const fileName = `${hash}.webp`;
  const { error } = await supabaseClient.storage.from('products').upload(fileName, optimized, {
    cacheControl: '31536000',
    contentType: 'image/webp',
    upsert: false
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  const { data } = supabaseClient.storage.from('products').getPublicUrl(fileName);
  if (!data?.publicUrl) throw new Error('Storage no devolvió una URL pública.');
  return data.publicUrl;
}

async function uploadGalleryImages(files) {
  return Promise.all(Array.from(files, uploadImage));
}

async function deleteUnusedProductImages(urls) {
  const prefix = '/storage/v1/object/public/products/';
  const candidates = [...new Set(urls)].filter(Boolean);
  if (!candidates.length) return;
  const { data: products, error: readError } = await supabaseClient
    .from('products')
    .select('image_url,image_urls');
  if (readError) {
    console.warn('No se pudo comprobar el uso de las imágenes:', readError.message);
    return;
  }
  const usedUrls = new Set((products || []).flatMap(product => [
    product.image_url,
    ...(Array.isArray(product.image_urls) ? product.image_urls : [])
  ]).filter(Boolean));
  const paths = candidates.filter(url => !usedUrls.has(url)).map(url => {
    try { const pathname = new URL(url).pathname; return pathname.includes(prefix) ? decodeURIComponent(pathname.split(prefix)[1]) : ''; }
    catch { return ''; }
  }).filter(Boolean);
  if (!paths.length) return;
  const { error } = await supabaseClient.storage.from('products').remove(paths);
  if (error) console.warn('No se pudieron limpiar algunos archivos de Storage:', error.message);
}

async function createSaleWithStock(sale) {
  const { data, error } = await supabaseClient.rpc('create_sale_with_stock', { sale_data: sale });
  if (error) throw error;
  return normalizeSale(data);
}

async function createSalesWithStock(sales) {
  const { data, error } = await supabaseClient.rpc('create_sales_with_stock', { sales_data: sales });
  if (error) throw error;
  return (data || []).map(normalizeSale);
}

async function changeSaleStatusWithStock(id, status) {
  const { data, error } = await supabaseClient.rpc('change_sale_status_with_stock', {
    sale_id: String(id),
    new_status: status
  });
  if (error) throw error;
  return normalizeSale(data);
}

async function deleteSaleWithStock(id) {
  const { error } = await supabaseClient.rpc('delete_sale_with_stock', { sale_id: String(id) });
  if (error) throw error;
}
