import { expect, it } from 'vitest';
import { activeSignalPlan, signalState, clockErrors, projectInstant, projectLocalTime, windowActive, type ProjectClock, type SignalPlan } from '../src/index';

const clock: ProjectClock = { anchor: projectInstant('2026-11-17', 7 * 60 + 45, 'Europe/Rome'), timeZone: 'Europe/Rome', durationS: 3600, speed: 1, holiday: false };
it('global clock uses project timezone and rolls through midnight independent of workstation timezone', () => {
  expect(projectLocalTime(clock)).toMatchObject({ date: '2026-11-17', day: 1, minutes: 465 });
  expect(projectLocalTime(clock, 18 * 3600)).toMatchObject({ date: '2026-11-18', day: 2, minutes: 105 });
  expect(clockErrors({ ...clock, timeZone: 'Missing/Zone' })).toContain('Fuso orario non valido');
});
it('DST gaps fail explicitly and repeated wall times have an explicit fold choice', () => {
  expect(() => projectInstant('2026-03-29', 150, 'Europe/Rome')).toThrow('non esiste');
  const earlier = projectInstant('2026-10-25', 150, 'Europe/Rome', 'earlier');
  const later = projectInstant('2026-10-25', 150, 'Europe/Rome', 'later');
  expect(Date.parse(later) - Date.parse(earlier)).toBe(3600000);
  expect(() => projectInstant('2026-02-31', 480, 'Europe/Rome')).toThrow('Data non valida');
});
it('overnight restrictions carry into the next day, never into the previous morning', () => {
  const monday = [{ days: [0], from: '22:00', to: '06:00' }];
  expect(windowActive(monday, 0, 23 * 60)).toBe(true);
  expect(windowActive(monday, 1, 5 * 60)).toBe(true);
  expect(windowActive(monday, 0, 5 * 60)).toBe(false);
  expect(windowActive(monday, 1, 6 * 60)).toBe(false);
});
it('calendar signal programmes change the actual controller and retain the base plan outside their window', () => {
  const phase = { id: 'g', name: 'Green', greenGroups: ['a'], greenS: 10, yellowS: 3, allRedS: 2, pedestrianRoadIds: [] };
  const plan: SignalPlan = { id: 'p', name: 'Plan', nodeId: 'n', mode: 'fixed_time', cycleS: 30, offsetS: 0,
    phases: [phase, { ...phase, id: 'r', greenGroups: ['b'] }], programmes: [{ id: 'peak', name: 'Peak', schedule: [{ days: [1], from: '07:45', to: '09:00' }], cycleS: 40, offsetS: 0,
      phases: [{ ...phase, greenS: 20 }, { ...phase, id: 'r', greenGroups: ['b'] }] }] };
  const at = projectLocalTime(clock);
  expect(activeSignalPlan(plan, at).cycleS).toBe(40);
  expect(signalState(plan, 'a', 12, undefined, at)).toBe('green');
  expect(signalState(plan, 'a', 12, undefined, { ...at, minutes: 600 })).toBe('yellow');
  expect(activeSignalPlan(plan, { ...at, holiday: true })).toBe(plan);
});
