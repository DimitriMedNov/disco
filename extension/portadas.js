// Portadas: los reproductores dan la portada como dirección (https://… en Spotify, file:///tmp/…
// en Brave y Firefox). Se deja una copia en ~/.cache/disco con un nombre propio por portada, para
// que GNOME no muestre una vieja cuando el navegador reescribe el mismo archivo.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const CARPETA = GLib.build_filenamev([GLib.get_user_cache_dir(), 'disco']);
const GUARDAR = 40; // portadas que se conservan
const sesion = new Soup.Session({timeout: 15});

function huella(texto) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, texto, -1);
}

function limpiar() {
    try {
        const dir = Gio.File.new_for_path(CARPETA);
        const it = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        const lista = [];
        let info;
        while ((info = it.next_file(null)))
            lista.push([info.get_name(), info.get_modification_date_time()?.to_unix() ?? 0]);
        lista.sort((a, b) => b[1] - a[1]);
        for (const [nombre] of lista.slice(GUARDAR))
            dir.get_child(nombre).delete(null);
    } catch {
        // no pasa nada si no se pudo limpiar
    }
}

function bajar(url, destino, cancelable) {
    // Spotify a veces da open.spotify.com/image/…, que ya no responde; la misma imagen está en i.scdn.co.
    const directa = url.replace('https://open.spotify.com/image/', 'https://i.scdn.co/image/');
    const msg = Soup.Message.new('GET', directa);
    if (!msg)
        return Promise.reject(new Error('dirección inválida'));
    return new Promise((resolver, rechazar) => {
        sesion.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancelable, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK)
                    throw new Error(`respondió ${msg.get_status()}`);
                GLib.file_set_contents(destino, bytes.get_data());
                resolver(destino);
            } catch (e) {
                rechazar(e);
            }
        });
    });
}

// Devuelve la ruta de un archivo local con la portada, o null si no hay o no se pudo.
export async function portadaLocal(url, cancelable = null) {
    if (!url)
        return null;
    GLib.mkdir_with_parents(CARPETA, 0o755);
    try {
        if (url.startsWith('file://')) {
            const origen = Gio.File.new_for_uri(url);
            const info = origen.query_info('time::modified,standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const sello = `${url}:${info.get_modification_date_time()?.to_unix() ?? 0}:${info.get_size()}`;
            const destino = GLib.build_filenamev([CARPETA, `${huella(sello)}.img`]);
            if (!GLib.file_test(destino, GLib.FileTest.EXISTS)) {
                origen.copy(Gio.File.new_for_path(destino), Gio.FileCopyFlags.OVERWRITE, null, null);
                limpiar();
            }
            return destino;
        }
        if (/^https?:\/\//.test(url)) {
            const destino = GLib.build_filenamev([CARPETA, `${huella(url)}.img`]);
            if (!GLib.file_test(destino, GLib.FileTest.EXISTS)) {
                await bajar(url, destino, cancelable);
                limpiar();
            }
            return destino;
        }
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.warn(`Disco: no pude obtener la portada ${url}: ${e.message}`);
    }
    return null;
}

export function abortar() {
    sesion.abort();
}
