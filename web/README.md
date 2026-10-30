# Supervisor Finder: web app

Next.js + Payload app for students, supervisors and admins. Search and all LLM work
stay in the Python service one folder up (`../app.py`); this app calls it.

## First run (Windows, VS Code terminal)

1. Start the Python service in its own terminal, from the folder above:
   `uvicorn app:app --reload`
2. In a second terminal: `cd web`
3. Copy `.env.example` to `.env` and fill in `PAYLOAD_SECRET` and `SERVICE_KEY`
   (the same SERVICE_KEY as in the Python `.env`).
4. `npm install`
5. `npm run seed`   (creates the database and the demo logins)
6. `npm run dev`, then open http://localhost:3000 (it sends you to the login page)

## Demo logins (local only)

| Login | Role | Linked to |
|---|---|---|
| admin@example.com | admin | everything |
| supervisor@example.com | supervisor | Syed Ali Hassan (btech-030) |
| student@example.com | student | Amina Rahman (student-001, dummy) |

Password: `SEED_PASSWORD` from `.env` (default `demo-password-1`).

## Rules built in (defaults, to confirm at the 4 November meeting)

- Admin sets each supervisor's slots (0 to 7); a supervisor can only lower them.
- Request types: "Discuss an idea" and "Request supervision".
- At most 3 open requests per student, one per supervisor.
- Accepting a supervision request is blocked when the supervisor has no slots left.
- Every supervisor profile change keeps the old values in Profile versions and updates search right away.

## Pages

| Address | Who | What |
|---|---|---|
| /login | everyone | sign in; sends you to your own area |
| /student | students | chat with search options, cards with slots and a Contact button |
| /student/requests | students | the requests you sent and their status |
| /supervisor | supervisors | requests with the note summary; accept, decline or ask for details, then an email draft to open in Outlook |
| /supervisor/profile | supervisors | edit research areas, expectations, room; lower slots |
| /admin | admins only | Payload admin panel |

New requests send the supervisor an email notice. With no email adapter set up, the notice is printed in the web terminal instead (look for "Email attempted").
