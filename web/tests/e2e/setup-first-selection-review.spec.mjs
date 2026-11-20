import {test,expect} from '@playwright/test';
const root='/pro-meta-intelligence/';
const progress=p=>p.locator('.draft-turn-progress');
const setupSelect=p=>p.getByRole('combobox',{name:'시작할 첫 선택 진영',exact:true});
async function settings(p){const d=p.locator('.draft-flow-options');if(await d.getAttribute('open')===null)await d.locator(':scope > summary').click();return setupSelect(p);}
async function start(p){await p.getByRole('button',{name:/^(밴픽 시작|밴픽 이어가기)$/}).click();}
async function pick(p){await p.locator('.draft-picker-grid button:not(:disabled)').first().click();await p.locator('.draft-lock-in').getByRole('button',{name:/^(밴|픽) 확정$/}).click();}
for(const first of ['RED','BLUE'])test(`setup first ${first} is explicit before the opposite manual side starts; reload stays off`,async({page})=>{
 await page.goto(root);await expect(page.getByRole('button',{name:'밴픽 시작',exact:true})).toBeEnabled({timeout:45000});
 await expect(page.locator('.draft-flow-options')).not.toHaveAttribute('open','');
 const config=await settings(page);await expect(config).toHaveValue('BLUE');await config.selectOption(first);
 const mine=first==='RED'?'BLUE':'RED';await page.locator(`.draft-flow-mode input[value="SOLO_${mine}"]`).check();
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','0');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await start(page);await expect(progress(page)).toHaveAttribute('value','1');await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','1');
 await expect(page.locator('.draft-sequence-mini li.done').first()).toContainText(`${first[0]}B1`);
 await expect(page.locator('.draft-first-selection select')).toHaveValue(first);await expect(page.locator('.draft-first-selection select')).toBeDisabled();
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await expect(await settings(page)).toBeDisabled();await expect(config).toHaveValue(first);
 await start(page);await page.reload();await expect(progress(page)).toHaveAttribute('value','1',{timeout:45000});
 await expect(page.locator('.draft-first-selection select')).toHaveValue(first);
 await expect(page.getByRole('checkbox',{name:'상대 자동 밴픽',exact:true})).not.toBeChecked();
});

test('new set first-selection remains editable with ten Fearless locks; staged card locks and persists',async({page})=>{
 await page.goto(root);await expect(page.getByRole('button',{name:'밴픽 시작',exact:true})).toBeEnabled({timeout:45000});await start(page);
 await page.waitForTimeout(900);await expect(progress(page)).toHaveAttribute('value','0');
 for(let i=1;i<=20;i++){await pick(page);await expect(progress(page)).toHaveAttribute('value',String(i));}
 await page.getByRole('button',{name:'세트 저장하고 다음 세트',exact:true}).click();await expect(progress(page)).toHaveAttribute('value','0');
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();const config=await settings(page);await expect(config).toBeEnabled();await config.selectOption('RED');
 await start(page);await expect(page.locator('.draft-first-selection select')).toHaveValue('RED');
 const filter=page.getByRole('checkbox',{name:'선택 가능한 챔피언만',exact:true});await filter.uncheck();
 await expect(page.locator('.draft-picker-grid button:disabled')).toHaveCount(10);
 await page.locator('.draft-picker-grid button:not(:disabled)').first().click();const staged=await page.locator('.draft-lock-in > div > span').textContent();
 await page.getByRole('button',{name:'팀 선택으로',exact:true}).click();await expect(await settings(page)).toBeDisabled();
 await start(page);await expect(page.locator('.draft-lock-in > div > span')).toHaveText(staged);
 const save=page.locator('.draft-session-details');if(await save.getAttribute('open')===null)await save.locator(':scope > summary').click();await expect(save.getByRole('status').filter({hasText:'이 기기에 저장됨'})).toBeVisible();
 await page.reload();await expect(page.locator('.draft-lock-in > div > span')).toHaveText(staged,{timeout:45000});
 await expect(page.locator('.draft-first-selection select')).toHaveValue('RED');await expect(page.getByRole('checkbox',{name:'상대 자동 밴픽',exact:true})).not.toBeChecked();
 await page.getByRole('checkbox',{name:'선택 가능한 챔피언만',exact:true}).uncheck();await expect(page.locator('.draft-picker-grid button:disabled')).toHaveCount(10);
});
