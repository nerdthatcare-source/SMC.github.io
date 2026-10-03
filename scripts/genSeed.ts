import fs from 'fs';
import { APPROVED_INSTRUMENTS_LIST } from '../src/engine/instrumentMarketConfiguration.ts';

const now = Date.now();
const rows = APPROVED_INSTRUMENTS_LIST.map((i) => {
  const sym = i.symbol.replace(/'/g, "''");
  const deriv = i.brokerSymbolMapping.derivSymbol.replace(/'/g, "''");
  const name = i.name.replace(/'/g, "''");
  const ac = i.assetClass.replace(/'/g, "''");
  const atr = i.atrSource.replace(/'/g, "''");
  return `('${sym}', '${deriv}', '${name}', '${ac}', ${i.pipSize}, ${i.pipValue}, ${i.contractSize}, '${atr}', 1, ${now}, ${now})`;
});

const sql = `INSERT INTO instruments_master (
  symbol, deriv_symbol, display_name, asset_class,
  pip_size, pip_value, contract_size, atr_source,
  is_active, created_at, updated_at
) VALUES \n` + rows.join(',\n') + `\nON CONFLICT (symbol) DO UPDATE SET
  deriv_symbol = EXCLUDED.deriv_symbol,
  display_name = EXCLUDED.display_name,
  asset_class = EXCLUDED.asset_class,
  pip_size = EXCLUDED.pip_size,
  pip_value = EXCLUDED.pip_value,
  contract_size = EXCLUDED.contract_size,
  atr_source = EXCLUDED.atr_source,
  updated_at = EXCLUDED.updated_at;`;

fs.writeFileSync('/tmp/seed_instruments.sql', sql);
console.log('Seed SQL generated successfully for ' + APPROVED_INSTRUMENTS_LIST.length + ' instruments.');
