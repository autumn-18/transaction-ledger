const transferService = require('../services/transfer.service');
const { validateCreateTransfer } = require('../validators/transfer.validator');

async function createTransfer(req, res) {
  const input = validateCreateTransfer(req.body);
  const result = await transferService.transfer(input);
  res.status(201).json({ success: true, data: result });
}

module.exports = { createTransfer };
