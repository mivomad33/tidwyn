import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pruneSnapshots, takeSnapshot } from "../src/snapshot.ts";
import { NOW, cleanupTemp, tempDir } from "./helpers.ts";

after(cleanupTemp);

describe("4.3-4 실행 전 사본", () => {
  test("DB가 있으면 시각이 붙은 사본을 데이터 폴더 안에 만든다", () => {
    const dir = tempDir();
    const db = path.join(dir, "tidwyn.db");
    fs.writeFileSync(db, "db-bytes");
    const file = takeSnapshot(dir, db, NOW);
    assert.equal(file, path.join(dir, "snapshots", "tidwyn-20261028-090000.db"));
    assert.equal(fs.readFileSync(file, "utf8"), "db-bytes");
    const second = takeSnapshot(dir, db, NOW);
    assert.notEqual(second, file, "같은 시각에 다시 찍어도 덮어쓰지 않는다");
  });
  test("DB가 없으면 사본을 만들지 않는다", () => {
    const dir = tempDir();
    assert.equal(takeSnapshot(dir, path.join(dir, "tidwyn.db"), NOW), null);
    assert.equal(fs.existsSync(path.join(dir, "snapshots")), false);
  });
  test("15일 전 사본은 지우고 13일 전 사본은 남긴다", () => {
    const dir = tempDir();
    const snaps = path.join(dir, "snapshots");
    fs.mkdirSync(snaps);
    const names = ["tidwyn-20261013-090000.db", "tidwyn-20261015-090000.db", "tidwyn-20261027-090000.db", "other.txt"];
    for (const n of names) fs.writeFileSync(path.join(snaps, n), "x");
    assert.deepEqual(pruneSnapshots(dir, NOW), ["tidwyn-20261013-090000.db"]);
    assert.deepEqual(fs.readdirSync(snaps).sort(), ["other.txt", "tidwyn-20261015-090000.db", "tidwyn-20261027-090000.db"]);
  });
});
