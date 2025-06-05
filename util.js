/** Down‑samples an array by keeping one every `step` elements. */
export function decimate(array, step = 10) {
    const out = [];
    for (let i = 0; i < array.length; i += step) out.push(array[i]);
    return out;
  }
  
  /** Simple debounce: waits `wait` ms after the last call before firing `fn`. */
  export function debounce(fn, wait = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }