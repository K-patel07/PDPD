import { useEffect } from "react";

export function useInterval(fn, ms) {
  useEffect(() => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [fn, ms]);
}
