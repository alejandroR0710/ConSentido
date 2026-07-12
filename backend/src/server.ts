import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

// "0.0.0.0" (no solo localhost) para que otros dispositivos en la misma red
// Wi-Fi puedan llegar al backend por la IP local de esta máquina.
app.listen(port, "0.0.0.0", () => {
  console.log(`SIsteMAPOS backend escuchando en http://0.0.0.0:${port} (accesible en tu red local)`);
});
