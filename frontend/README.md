# RTOGuard AI Frontend

This is the React + TypeScript + Vite user interface. For the combined project and full startup instructions, read the `README.md` in the project root.

For development, use `start-frontend.bat` from the project root, or run:

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

The `.env.example` defaults to `http://localhost:8000/api` and Live Backend
mode. `start-frontend.bat` copies it to `.env` automatically when needed. If the
browser has a saved source-mode preference, that preference takes priority;
change it under **Settings & APIs**.
