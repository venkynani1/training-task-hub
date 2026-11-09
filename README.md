# Training Task Hub

A small Next.js app for running corporate trainings day to day:

- **Tasks from emails** — drag an Outlook email (or a saved `.msg` / `.eml`) onto the page, or paste the text. AI (Groq) reads it, drafts a task with steps, and asks about anything missing before you save. You can also tick "add to training tracker" to create the training row in one go.
- **Manual tasks** — title, due date, priority, status (To do / In progress / Waiting / Done), checklist, linked training.
- **Training tracker** — an editable, spreadsheet-style grid. Import your schedule from Excel (`.xlsx` / `.csv`) or type rows in. Status changes on its own from the dates: **Scheduled → Ongoing → Completed** (India time). Set **On Hold** or **Cancelled** manually when needed. Export the whole tracker as CSV.
- **Daily attendance** — per training: import participants from Excel or paste them, tap cells to mark P / A, "All P" per day, attendance % per person, and download any day as a CSV for the LMS upload. Dates stay editable.

## Deploy on Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. In the Vercel project → **Storage** → add a **Neon** Postgres database. That sets `DATABASE_URL`. Tables are created automatically on first use.
3. In **Settings → Environment Variables** add:
   - `GROQ_API_KEY` — free key from console.groq.com/keys (without it, emails are read with simple rules instead of AI)
   - `APP_PASSWORD` — the passcode to open the app
   - optional `GROQ_MODEL` (default `llama-3.3-70b-versatile`), or `ANTHROPIC_API_KEY` to use Claude instead
4. Redeploy.

## Run locally

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev
```

## Excel schedule format

The importer finds the header row on its own and matches common names, e.g. `Training Name / Course`, `Trainer / Faculty`, `Requested By / Team`, `Mode`, `Location / Venue`, `Start Date / From Date`, `End Date / To Date`, `Start Time`, `End Time`, `Notes / Remarks`. Dates can be real Excel dates or text like `17-11-2026` (day first) or `17 Nov 2026`. Use **Template** on the tracker page for a sample.

Participant sheets need a `Name` column; `Emp ID` and `Email` are optional.

## Outlook tip

Dragging straight out of classic Outlook for Windows into Chrome or Edge gives the browser a `.msg` file. If your Outlook doesn't allow that (new Outlook / web), use **Paste email text** or save the mail as `.msg` first.
