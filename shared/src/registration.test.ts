import { describe, expect, it } from 'vitest';
import { gymCodeFromName, isValidContactPhone, isValidEmail, passwordProblem, prefixFromName } from './registration';

describe('gym self-registration rules', () => {
  it('gym code is a lowercase slug of the name', () => {
    expect(gymCodeFromName('Iron House Fitness')).toBe('iron-house-fitness');
    expect(gymCodeFromName('  Café  Gym & Spa!! ')).toBe('cafe-gym-and-spa');
    expect(gymCodeFromName('ایرن ہاؤس')).toBe('gym');
    expect(gymCodeFromName('A'.repeat(50))).toHaveLength(30);
    expect(gymCodeFromName('abcdefghijklmnopqrstuvwxyz abcd')).not.toMatch(/-$/);
  });

  it('member prefix from initials', () => {
    expect(prefixFromName('Iron House Fitness')).toBe('IHF');
    expect(prefixFromName('Powerhouse')).toBe('PO');
    expect(prefixFromName('The Big Iron Gym')).toBe('TBI');
    expect(prefixFromName('!!!')).toBe('GYM');
  });

  it('emails and contact phones', () => {
    expect(isValidEmail('owner@ironhouse.pk')).toBe(true);
    expect(isValidEmail('owner@ironhouse')).toBe(false);
    expect(isValidEmail('no spaces@x.pk')).toBe(false);
    expect(isValidContactPhone('042-35761234')).toBe(true);
    expect(isValidContactPhone('+92 300 1234567')).toBe(true);
    expect(isValidContactPhone('12345')).toBe(false);
    expect(isValidContactPhone('call me')).toBe(false);
  });

  it('password rules', () => {
    expect(passwordProblem('short1', 'short1')).toMatch(/at least 8/);
    expect(passwordProblem('onlyletters', 'onlyletters')).toMatch(/letter and one number/);
    expect(passwordProblem('12345678', '12345678')).toMatch(/letter and one number/);
    expect(passwordProblem('goodpass1', 'goodpass2')).toBe('Passwords do not match.');
    expect(passwordProblem('x1'.repeat(40), 'x1'.repeat(40))).toMatch(/at most 72/);
    expect(passwordProblem('goodpass1', 'goodpass1')).toBeNull();
  });
});
