const ROOMS = ['ROOM 1', 'ROOM 2', 'ROOM 3'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Only these types may be opened inline in the browser; everything else is download-only.
const VIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

// "data:image/png;base64,...." -> "image/png" (or null if it is not a base64 data URL)
function fileMime(data) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(String(data).slice(0, 120));
  return m ? m[1] : null;
}
function validFile(name, data) {
  return typeof name === 'string' && name.length > 0 && name.length <= 200 &&
    typeof data === 'string' && data.length <= MAX_FILE_BYTES * 1.4 && fileMime(data) !== null;
}
module.exports = { ROOMS, MAX_FILE_BYTES, VIEWABLE, fileMime, validFile };
