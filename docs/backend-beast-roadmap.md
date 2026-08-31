# Ilm o Irfan — Absolute Beast Backend Roadmap

**Progress report:** [`backend-work-progress.md`](./backend-work-progress.md)

**Progress:**  
- §1–§4 code + audit #1/#2/#4 — **done in-repo**  
- §5 admin EF wrappers — **done in-repo**  
- Hosted deploy / real import / e2e — **blocked** (no project ref, no Docker, no BOOKS_DIR)

---

## Blocked (not by agent choice)

1. Hosted link/push/deploy — need **project ref** + CLI login  
2. Local stack / e2e — need **Docker**  
3. Real catalog ingest — need **BOOKS_DIR** + `.env`  

---

## Suggested next

1. **You:** project ref → finish §2 deploy  
2. **You:** books folder → import  
3. **Agent:** CI scaffolding / `admin-book-create` / authors CRUD / FE contract fixtures  

---

## Done checklist (abbreviated)

- [x] Hygiene, deploy checklist, free-book PDF, webhook ledger  
- [x] Seed shelves, harden import, home-feed/library/profile polish, streak lock  
- [x] Admin RPC wrappers (delete/bulk/relations/collections/reorder/entitlement/role/detail/storage/dashboard)  
- [x] `highlights-delete`  
- [ ] Hosted deploy + smoke  
- [ ] Real books + storage audit  
- [ ] Google OAuth + RC sandbox  
- [ ] CI + merge to `main`
