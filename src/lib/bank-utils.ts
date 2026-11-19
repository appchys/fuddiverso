import { Business } from '@/types'

export const DEFAULT_BANK_OPTIONS = [
  'Banco Pichincha',
  'Banco Guayaquil',
  'Banco del Pacífico',
  'Produbanco',
  'Deuna!',
] as const

const BANK_CANONICAL_NAMES: Record<string, string> = {
  'pichincha': 'Banco Pichincha',
  'banco pichincha': 'Banco Pichincha',
  'banco del pichincha': 'Banco Pichincha',
  'guayaquil': 'Banco Guayaquil',
  'banco guayaquil': 'Banco Guayaquil',
  'banco de guayaquil': 'Banco Guayaquil',
  'pacifico': 'Banco del Pacífico',
  'banco pacifico': 'Banco del Pacífico',
  'banco del pacifico': 'Banco del Pacífico',
  'produbanco': 'Produbanco',
  'banco produbanco': 'Produbanco',
  'bolivariano': 'Banco Bolivariano',
  'banco bolivariano': 'Banco Bolivariano',
  'internacional': 'Banco Internacional',
  'banco internacional': 'Banco Internacional',
  'austro': 'Banco del Austro',
  'banco austro': 'Banco del Austro',
  'banco del austro': 'Banco del Austro',
  'deuna': 'Deuna!',
  'deuna!': 'Deuna!',
  'de una': 'Deuna!',
  'jep': 'Cooperativa JEP',
  'cooperativa jep': 'Cooperativa JEP',
}

const cleanBankKey = (str: string): string =>
  str
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

export const normalizeBankName = (raw?: string | null): string => {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  if (!trimmed) return ''
  const key = cleanBankKey(trimmed)
  return BANK_CANONICAL_NAMES[key] || trimmed
}

export const getBankSelectOptions = (
  business?: Pick<Business, 'bankAccountMode' | 'bankAccounts' | 'bankAccount'> | null,
  currentBank?: string | null
): string[] => {
  const seen = new Set<string>()
  const options: string[] = []

  const addOption = (name?: string | null) => {
    const normalized = normalizeBankName(name)
    if (!normalized) return
    const key = cleanBankKey(normalized)
    if (!seen.has(key)) {
      seen.add(key)
      options.push(normalized)
    }
  }

  if (business?.bankAccountMode === 'custom') {
    if (Array.isArray(business.bankAccounts)) {
      business.bankAccounts.forEach(acc => addOption(acc?.bankName))
    }
    if (business.bankAccount?.bankName) {
      addOption(business.bankAccount.bankName)
    }
  }

  DEFAULT_BANK_OPTIONS.forEach(addOption)

  if (currentBank) {
    addOption(currentBank)
  }

  return options
}
