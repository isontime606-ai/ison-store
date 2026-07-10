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

  return new Promise((resolve) => {

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

    img.src = URL.createObjectURL(file);

  });

}


/**
 * Sube una imagen al bucket "products"
 * y devuelve la URL pública.
 */
async function uploadImage(file) {

  try {

    const compressed = await compressImage(file);

    const fileName =
      Date.now() +
      "_" +
      Math.random().toString(36).substring(2,8) +
      ".jpg";

    const { error } = await supabaseClient.storage
      .from("products")
      .upload(fileName, compressed, {
        cacheControl: "3600",
        upsert: false
      });

    if (error) {

      console.error("ERROR SUBIENDO:", error);
      return null;

    }

    const { data } = supabaseClient.storage
      .from("products")
      .getPublicUrl(fileName);

    return data.publicUrl;

  }
  catch(err){

    console.error(err);
    return null;

  }

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