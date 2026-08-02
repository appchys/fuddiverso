/**
 * Optimiza una imagen comprimiéndola y redimensionándola antes de subirla
 */
export async function optimizeImage(
    file: File,
    maxWidth = 800,
    quality = 0.7,
    mimeType: 'image/webp' | 'image/jpeg' | 'image/png' = 'image/webp'
): Promise<Blob> {
    const isHeicLike = (f: File) => {
        const name = (f.name || '').toLowerCase();
        const type = (f.type || '').toLowerCase();
        return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
    }

    const convertHeicToJpegIfNeeded = async (f: File): Promise<File> => {
        if (!isHeicLike(f)) return f;

        if (typeof window === 'undefined') return f;

        try {
            const mod: any = await import('heic2any');
            const heic2any = mod?.default || mod;
            const converted: any = await heic2any({
                blob: f,
                toType: 'image/jpeg',
                quality: Math.min(1, Math.max(0.1, quality))
            });

            const convertedBlob: Blob = Array.isArray(converted) ? converted[0] : converted;
            return new File([
                convertedBlob
            ], (f.name || 'image').replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
        } catch (e) {
            console.warn('No se pudo convertir HEIC/HEIF a JPEG, intentando continuar:', e);
            return f;
        }
    }

    return new Promise((resolve, reject) => {
        convertHeicToJpegIfNeeded(file)
            .then((convertedFile) => {
                let objectUrl: string | null = null;
                try {
                    objectUrl = URL.createObjectURL(convertedFile);
                } catch (e) {
                    console.warn('URL.createObjectURL falló, usando FileReader fallback:', e);
                }

                const img = new Image();

                const cleanup = () => {
                    if (objectUrl) {
                        try {
                            URL.revokeObjectURL(objectUrl);
                        } catch (e) {}
                    }
                };

                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Redimensionar si es más grande que el máximo permitido
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        cleanup();
                        reject(new Error('No se pudo obtener el contexto del canvas'));
                        return;
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    const tryEncode = (
                        type: 'image/webp' | 'image/jpeg' | 'image/png',
                        onDone: (blob: Blob | null) => void
                    ) => {
                        if (canvas.toBlob) {
                            canvas.toBlob(
                                (blob) => onDone(blob),
                                type,
                                quality
                            );
                        } else {
                            // Fallback para WebViews legacy sin HTMLCanvasElement.toBlob
                            try {
                                const dataUrl = canvas.toDataURL(type, quality);
                                const arr = dataUrl.split(',');
                                const mimeMatch = arr[0].match(/:(.*?);/);
                                const mime = mimeMatch ? mimeMatch[1] : type;
                                const bstr = atob(arr[1]);
                                let n = bstr.length;
                                const u8arr = new Uint8Array(n);
                                while (n--) {
                                    u8arr[n] = bstr.charCodeAt(n);
                                }
                                onDone(new Blob([u8arr], { type: mime }));
                            } catch (err) {
                                onDone(null);
                            }
                        }
                    };

                    // Convertir a blob (por defecto WebP; fallback a JPEG si WebP no está soportado)
                    tryEncode(mimeType, (blob) => {
                        if (blob && blob.type) {
                            cleanup();
                            resolve(blob);
                            return;
                        }

                        if (mimeType === 'image/webp') {
                            tryEncode('image/jpeg', (jpegBlob) => {
                                cleanup();
                                if (jpegBlob) {
                                    resolve(jpegBlob);
                                } else {
                                    reject(new Error('Error al comprimir la imagen'));
                                }
                            });
                            return;
                        }

                        cleanup();
                        if (blob) {
                            resolve(blob);
                            return;
                        }

                        reject(new Error('Error al comprimir la imagen'));
                    });
                };

                img.onerror = (err) => {
                    cleanup();
                    reject(err);
                };

                if (objectUrl) {
                    img.src = objectUrl;
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        img.src = e.target?.result as string;
                    };
                    reader.onerror = (err) => {
                        cleanup();
                        reject(err);
                    };
                    reader.readAsDataURL(convertedFile);
                }
            })
            .catch(reject);
    });
}
