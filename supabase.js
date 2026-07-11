// Crear cliente de Supabase
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

/**
 * Comprime una imagen antes de subirla.
 * Reduce mucho el peso sin perder calidad visible.
 */
async function compressImage(file, maxWidth = 1200, quality = 0.75) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Selecciona una imagen válida.');
  }
  return new Promise((resolve, reject) => {

    const img = new Image();

    img.onload = () => {

      const canvas = document.createElement("canvas");

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('No fue posible comprimir la imagen.')); return; }

        resolve(
          new File(
            [blob],
            file.name.replace(/\.[^/.]+$/, ".jpg"),
            {
              type: "image/jpeg"
            }
          )
        );

      }, "image/jpeg", quality);

    };

    img.onerror = () => reject(new Error('No fue posible leer la imagen.'));
    const objectUrl = URL.createObjectURL(file);
    img.onloadend = () => URL.revokeObjectURL(objectUrl);
    img.src = objectUrl;

  });

}


/**
 * Sube una imagen al bucket "products"
 * y devuelve la URL pública.
 */
async function uploadImage(file) {
    const compressed = await compressImage(file);
    const digest = await crypto.subtle.digest('SHA-256', await compressed.arrayBuffer());
    const fileName = 'products/' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('') + '.jpg';

    const { error } = await supabaseClient.storage
      .from("products")
      .upload(fileName, compressed, {
        cacheControl: "3600",
        upsert: false
      });

    if (error && !/already exists|duplicate/i.test(error.message)) throw error;

    const { data } = supabaseClient.storage
      .from("products")
      .getPublicUrl(fileName);

    if (!data || !data.publicUrl) throw new Error('Storage no devolvió una URL pública.');
    return data.publicUrl;

}


/**
 * Sube varias imágenes.
 */
async function uploadGalleryImages(files){

  const urls=[];

  for(const file of files){

    const url=await uploadImage(file);

    if(url){
      urls.push(url);
    }

  }

  return urls;

}
