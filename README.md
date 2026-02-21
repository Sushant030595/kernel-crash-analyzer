# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Deployment (Netlify frontend + hosted backend)

This project separates frontend (Vite) and backend (FastAPI). A common deployment pattern is:

- Host the frontend on Netlify.
- Host the backend on Render / Railway / Fly (any host that supports Python and environment variables).

Quick steps — Frontend (Netlify):

1. Push your repository to GitHub.
2. On Netlify, choose "New site from Git" → connect GitHub → select this repo.
3. Set build settings in Netlify:
	- Build command: `npm run build`
	- Publish directory: `dist`
4. Add an environment variable in Netlify site settings:
	- `VITE_API_URL` = `https://your-backend.example.com`
5. Deploy the site.

Backend (Render example):

1. Create a new Web Service on Render and connect your repo.
2. Set the build/start command (example):
	- `uvicorn backend:app --host 0.0.0.0 --port $PORT`
3. Add environment variables in Render:
	- `ANTHROPIC_API_KEY` = your Anthropic key (do NOT commit this to the repo)
4. After deploy, copy the service URL (e.g., `https://your-service.onrender.com`) and use it as `VITE_API_URL` in Netlify.

Local testing:

1. Set `VITE_API_URL` for local dev in a `.env` file (see `.env.example`).
2. Start backend locally:

```powershell
uvicorn backend:app --reload --port 8000
```

3. Start frontend dev server:

```bash
npm install
npm run dev
```

Notes:
- Do not commit secrets. Use Netlify/Render environment settings for keys.
- `netlify.toml` is included with example settings — update `VITE_API_URL` and any redirects before deploying.
- CORS is currently open (`allow_origins=["*"]`) in `backend.py`. For production, restrict this to your frontend domain.
