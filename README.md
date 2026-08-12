# CSV Upload Starter

Next.js frontend (shadcn/ui) + Express backend. Upload a CSV from the UI; the API receives it in memory and does **not** write it to disk.

## Structure

```
ramp_cc/
├── frontend/   # Next.js + shadcn/ui
└── backend/    # Express + multer (memoryStorage)
```

## Run

Terminal 1 — backend:

```bash
cd backend
npm run dev
```

Terminal 2 — frontend:

```bash
cd frontend
npm run dev
```

- Frontend: http://localhost:3000  
- Backend: http://localhost:4000  

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/upload` | Multipart field `file` — CSV only, max 10 MB |

Response confirms receipt and returns a short text preview. The file buffer lives only for the request lifetime.
