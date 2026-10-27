/**
 * Mappers turn database rows into the JSON shape the API returns.
 */

const toMoney = (value) => Number(value);

function toAccount(row) {
  return {
    id: row.id,
    name: row.name,
    balance: toMoney(row.balance),
    created_at: row.created_at,
  };
}

function toTransaction(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    type: row.type,
    amount: toMoney(row.amount),
    description: row.description,
    reference_id: row.reference_id,
    transfer_id: row.transfer_id,
    created_at: row.created_at,
  };
}

function toTransfer(row) {
  return {
    id: row.id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
    amount: toMoney(row.amount),
    description: row.description,
    reference_id: row.reference_id,
    created_at: row.created_at,
  };
}

module.exports = { toAccount, toTransaction, toTransfer };
