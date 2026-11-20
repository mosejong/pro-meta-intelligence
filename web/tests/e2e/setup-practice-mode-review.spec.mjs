import { test, expect } from '@playwright/test';
const root='/pro-meta-intelligence/';
const progress=p=>p.locator('.draft-turn-progress');
const mode=(p,value)=>p.locator(`.draft-flow-mode input[value="${value}"]`);
const solo=p=>p.getByRole('region',{name:'혼자 밴픽 연습',exact:true});
async function notes(p){return p.evaluate(()=>new Promise((resolve,reject)=>{
 const open=indexedDB.open('pro-meta-draft',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction('sessions','readonly'),read=tx.objectStore('sessions').get('current-solo-review');
  read.onsuccess=()=>{db.close();const raw=typeof read.result==='string'?JSON.parse(read.result):null;resolve(raw?.records??[]);};read.onerror=()=>{db.close();reject(read.error);};
 };
}));}
async function manualTurn(p){await p.locator('.draft-picker-grid button:not(:disabled)').first().click();await p.locator('.draft-lock-in').getByRole('button',{name:/^(밴|픽) 확정$/}).click();}
async function openSetup(p){await p.goto(root);await expect(p.getByRole('button',{name:'밴픽 시작',exact:true})).toBeEnabled({timeout:45000});}

test('manual default; setup intent cannot act; explicit red start makes one blue action and reload stays manual',async({page},info)=>{
 await openSetup(page);await expect(mode(page,'MANUAL')).toBeChecked();
 await page.getByRole('button',{name:'밴픽 시작',exact:true}).click();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','0');
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();
 await mode(page,'SOLO_RED').check();await page.waitForTimeout(900);
 await expect(progress(page)).toHaveAttribute('value','0');
 expect(await notes(page)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('setup-solo-red.png'),fullPage:true});
 await page.getByRole('button',{name:'밴픽 시작',exact:true}).click();
 await expect(progress(page)).toHaveAttribute('value','1');await page.waitForTimeout(900);
 await expect(progress(page)).toHaveAttribute('value','1');
 await expect(solo(page).getByLabel('내 진영',{exact:true})).toHaveValue('RED');
 await expect.poll(async()=> (await notes(page)).map(r=>r.turn)).toEqual([1]);
 const kept=await notes(page);
 await page.reload();await expect(progress(page)).toHaveAttribute('value','1',{timeout:45000});
 await expect(solo(page).getByRole('checkbox',{name:'상대 자동 밴픽',exact:true})).not.toBeChecked();
 await expect.poll(()=>notes(page)).toEqual(kept);
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await expect(mode(page,'MANUAL')).toBeChecked();
 await page.getByRole('button',{name:'밴픽 이어가기',exact:true}).click();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','1');
 await expect.poll(()=>notes(page)).toEqual(kept);
});

test('blue solo unchanged continue preserves notes; pending mode switch clears only on explicit continue',async({page})=>{
 await openSetup(page);await mode(page,'SOLO_BLUE').check();await page.getByRole('button',{name:'밴픽 시작',exact:true}).click();
 await manualTurn(page);await expect(progress(page)).toHaveAttribute('value','2');
 await expect.poll(async()=> (await notes(page)).map(r=>r.turn)).toEqual([2]);
 const kept=await notes(page);
 await manualTurn(page);await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','3');
 await expect(mode(page,'SOLO_BLUE')).toBeChecked();
 await mode(page,'MANUAL').check();await page.waitForTimeout(900);
 await expect(progress(page)).toHaveAttribute('value','3');expect(await notes(page)).toEqual(kept);
 await mode(page,'SOLO_BLUE').check();
 await page.getByRole('button',{name:'밴픽 이어가기',exact:true}).click();
 await expect(progress(page)).toHaveAttribute('value','4');
 await expect.poll(async()=> (await notes(page)).map(r=>r.turn)).toEqual([2,4]);
 const after=await notes(page);expect(after[0]).toEqual(kept[0]);
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await mode(page,'MANUAL').check();
 await expect(page.locator('.draft-flow-mode')).toContainText('자동 선택 기록이 정리');
 expect(await notes(page)).toEqual(after);
 await page.getByRole('button',{name:'밴픽 이어가기',exact:true}).click();
 await expect(solo(page).getByRole('checkbox',{name:'상대 자동 밴픽',exact:true})).not.toBeChecked();
 await expect(progress(page)).toHaveAttribute('value','4');await expect.poll(()=>notes(page)).toEqual([]);
});

test('incoming shared hash drops a pending solo choice and never enables the opponent on load',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
 await openSetup(page);await page.getByRole('button',{name:'밴픽 시작',exact:true}).click();
 await manualTurn(page);await expect(progress(page)).toHaveAttribute('value','1');
 await page.getByRole('button',{name:'밴픽 링크 복사',exact:true}).click();
 const href=await page.getByLabel('복사할 밴픽 링크',{exact:true}).inputValue();
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await mode(page,'SOLO_RED').check();
 await page.evaluate(href=>{window.location.hash=new URL(href).hash;},href);
 const preview=page.getByRole('region',{name:'공유 밴픽 미리보기',exact:true});await expect(preview).toBeVisible();
 await expect(solo(page).getByRole('checkbox',{name:'상대 자동 밴픽',exact:true})).not.toBeChecked();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','1');
 await preview.getByRole('button',{name:'이 밴픽 불러오기',exact:true}).click();
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await expect(mode(page,'MANUAL')).toBeChecked();
 await page.getByRole('button',{name:'밴픽 이어가기',exact:true}).click();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','1');
});
