const express = require('express');
const accountController = require('../controllers/account.controller');
const transactionController = require('../controllers/transaction.controller');
const { validateAccountIdParam } = require('../middlewares/validateAccountIdParam');

const router = express.Router();

// router.param runs BEFORE any route that has ":accountId" in its path,
// so we check the ID format in one place instead of in every controller.
router.param('accountId', validateAccountIdParam);

router.post('/', accountController.createAccount);
router.get('/:accountId', accountController.getAccount);
router.get('/:accountId/balance', accountController.getBalance);

router.post('/:accountId/transactions', transactionController.addTransaction);
router.get('/:accountId/transactions', transactionController.getTransactionHistory);

// Immutability: no edit/delete endpoints exist. These answer with a clear 405.
router.put('/:accountId/transactions{/:transactionId}', transactionController.rejectModification);
router.patch('/:accountId/transactions{/:transactionId}', transactionController.rejectModification);
router.delete('/:accountId/transactions{/:transactionId}', transactionController.rejectModification);

module.exports = router;
