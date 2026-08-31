# Ilm o Irfan — Absolute Beast Backend Roadmap

**Progress report (source of truth for what ran):** [`backend-work-progress.md`](./backend-work-progress.md)

**Progress:**  
- §1 hygiene — **done**  
- §2 hosted — **prep done**; **blocked** (no project ref / no Docker)  
- Audit #2 webhook — **done in-repo**  
- §4 content + API polish — **code done**; **data import blocked** (no BOOKS_DIR / no linked project)

---

## Blocked right now (not by agent choice)

1. Hosted link/push/deploy — need your Supabase **project ref** + CLI login  
2. Local stack / e2e — need **Docker**  
3. Real catalog ingest — need **BOOKS_DIR** with PDFs + `.env` service role  

See progress report for the full “not happening / why” table.

---

## Suggested next (pick one)

1. **You:** send project ref → agent finishes §2 deploy  
2. **You:** put books on disk + `.env` → agent runs import  
3. **Agent:** continue unblocked code (admin EF wrappers, highlights-delete, CI scaffolding)

---

## Checklist (abbreviated)

- [x] Paths / env paywall / docs honesty  
- [x] Deploy checklist + npm deploy scripts  
- [x] Free-book PDF auth  
- [x] RevenueCat event ledger + order-safe apply  
- [x] Seed home shelves + featured collection  
- [x] Harden `books:import`  
- [x] `home-feed` shelves / `profile` DOB+streak / `library-overview` finished+highlights / streak lock  
- [ ] Hosted deploy + smoke  
- [ ] Real book upload + storage audit  
- [ ] Google OAuth + RC sandbox  
- [ ] Admin EF wrappers / CI / merge to `main`
