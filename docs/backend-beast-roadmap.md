# Ilm o Irfan — Absolute Beast Backend Roadmap

**Progress report:** [`backend-work-progress.md`](./backend-work-progress.md)

**Progress:**  
- §1–§6 code tracks — **done in-repo** (hygiene, deploy prep, webhook, content/API polish, admin EFs, CI, fixtures)  
- Hosted deploy / real import / Docker e2e — **blocked** (no project ref, no Docker, no BOOKS_DIR)

---

## Blocked (not by agent choice)

1. Hosted link/push/deploy — need **project ref** + CLI login  
2. Local stack / e2e — need **Docker**  
3. Real catalog ingest — need **BOOKS_DIR** + `.env`  

---

## Suggested next

1. **You:** project ref → finish deploy  
2. **You:** books folder → import  
3. **Agent:** only leftover code polish you request (category create EFs, deploy GH Action with secrets, etc.)

---

## Done checklist

- [x] Hygiene, paywall defaults, free-book PDF, webhook ledger  
- [x] Seed shelves, harden import, home-feed/library/profile, streak lock  
- [x] Admin RPC wrappers + book/author create CRUD + highlights-delete  
- [x] CI static checks + FE response fixtures  
- [ ] Hosted deploy + smoke  
- [ ] Real books + storage audit  
- [ ] Google OAuth + RC sandbox  
- [ ] Merge to `main`
