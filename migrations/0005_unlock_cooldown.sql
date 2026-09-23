-- 자물쇠 시도 사이의 간격. 브루트포스로 미로를 걷지 않고 번호를 알아내는 것을 막는다.
ALTER TABLE runs ADD COLUMN last_unlock_at INTEGER;
