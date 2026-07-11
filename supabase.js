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
  const statusMap = { Pendiente:'pendiente', Pagada:'pagado', Enviada:'enviado', Entregada:'entregado', Cancelada:'cancelado' };
  return {
    ...s,
    id: String(s.id),
    fecha: s.fecha || s.created_at,
    productoId: String(s.productoId ?? s.producto_id ?? ''),
    cantidad: Number(s.cantidad) || 1,
    total: Number(s.total) || 0,
    estado: statusMap[s.estado] || String(s.estado || 'pendiente').toLowerCase()
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
  const productId=sale.productoId ?? sale.producto_id;
  const quantity=Math.max(1,Number(sale.cantidad)||1);
  const {data:product,error:readError}=await supabaseClient.from('products').select('id,name,stock,price,preciodesc').eq('id',productId).single();
  if(readError) throw readError;
  const previousStock=Number(product.stock)||0;
  const requestedStatus={pendiente:'Pendiente',pagado:'Pagada',enviado:'Enviada',entregado:'Entregada',cancelado:'Cancelada'}[String(sale.estado||'pendiente').toLowerCase()]||'Pendiente';
  if(requestedStatus!=='Cancelada'&&previousStock<quantity) throw new Error(`Stock insuficiente para ${product.name}.`);
  const unitPrice=Number(sale.precio_unitario ?? (Number(product.preciodesc)>0?product.preciodesc:product.price))||0;
  const row={producto_id:Number(product.id),producto:product.name,cantidad:quantity,precio_unitario:unitPrice,total:Number(sale.total)||unitPrice*quantity,estado:requestedStatus};
  const {data:inserted,error:insertError}=await supabaseClient.from('sales').insert(row).select('*').single();
  if(insertError) throw insertError;
  const nextStock=requestedStatus==='Cancelada'?previousStock:previousStock-quantity;
  if(nextStock===previousStock) return normalizeSale(inserted);
  const {data:updated,error:updateError}=await supabaseClient.from('products').update({stock:nextStock}).eq('id',product.id).eq('stock',previousStock).select('id').maybeSingle();
  if(updateError || !updated){
    await supabaseClient.from('sales').delete().eq('id',inserted.id);
    throw updateError || new Error('El inventario cambió. Intenta nuevamente.');
  }
  return normalizeSale(inserted);
}

async function createSalesWithStock(sales) {
  const created=[];
  for(const sale of sales) created.push(await createSaleWithStock(sale));
  return created;
}

async function changeSaleStatusWithStock(id, status) {
  const dbStatus={pendiente:'Pendiente',pagado:'Pagada',enviado:'Enviada',entregado:'Entregada',cancelado:'Cancelada'}[status];
  if(!dbStatus) throw new Error('Estado inválido.');
  const {data:rawSale,error:readError}=await supabaseClient.from('sales').select('*').eq('id',id).single();
  if(readError) throw readError;
  const sale=normalizeSale(rawSale);
  if(sale.estado===status) return sale;
  const {data:product,error:productError}=await supabaseClient.from('products').select('id,stock').eq('id',sale.productoId).single();
  if(productError) throw productError;
  const previousStock=Number(product.stock)||0;
  let nextStock=previousStock;
  if(sale.estado!=='cancelado'&&status==='cancelado') nextStock+=sale.cantidad;
  if(sale.estado==='cancelado'&&status!=='cancelado'){
    if(previousStock<sale.cantidad) throw new Error('Stock insuficiente para reactivar la venta.');
    nextStock-=sale.cantidad;
  }
  if(nextStock!==previousStock){
    const {data:stockUpdated,error:stockError}=await supabaseClient.from('products').update({stock:nextStock}).eq('id',product.id).eq('stock',previousStock).select('id').maybeSingle();
    if(stockError || !stockUpdated) throw stockError || new Error('El inventario cambió. Intenta nuevamente.');
  }
  const {data:updatedSale,error:updateError}=await supabaseClient.from('sales').update({estado:dbStatus}).eq('id',id).select('*').single();
  if(updateError){
    if(nextStock!==previousStock) await supabaseClient.from('products').update({stock:previousStock}).eq('id',product.id).eq('stock',nextStock);
    throw updateError;
  }
  return normalizeSale(updatedSale);
}

async function deleteSaleWithStock(id) {
  const {data:rawSale,error:readError}=await supabaseClient.from('sales').select('*').eq('id',id).single();
  if(readError) throw readError;
  const sale=normalizeSale(rawSale);
  let product=null,previousStock=0,nextStock=0;
  if(sale.estado!=='cancelado'){
    const result=await supabaseClient.from('products').select('id,stock').eq('id',sale.productoId).single();
    if(result.error) throw result.error;
    product=result.data; previousStock=Number(product.stock)||0; nextStock=previousStock+sale.cantidad;
    const {data,error}=await supabaseClient.from('products').update({stock:nextStock}).eq('id',product.id).eq('stock',previousStock).select('id').maybeSingle();
    if(error || !data) throw error || new Error('El inventario cambió. Intenta nuevamente.');
  }
  const {data:deleted,error:deleteError}=await supabaseClient.from('sales').delete().eq('id',id).select('id').maybeSingle();
  if(deleteError || !deleted){
    if(product) await supabaseClient.from('products').update({stock:previousStock}).eq('id',product.id).eq('stock',nextStock);
    throw deleteError || new Error('No se pudo eliminar la venta.');
  }
}
