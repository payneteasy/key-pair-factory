import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// NOTE: deliberately NOT wrapped in <React.StrictMode>. The Generate screen
// fires a one-shot key-generation effect on mount; StrictMode's intentional
// double-invoke (mount → cleanup → mount) in dev would either generate twice
// or, with a mount guard, leave the surviving mount with no live timers —
// freezing "Elapsed 0.0s" and never completing.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
