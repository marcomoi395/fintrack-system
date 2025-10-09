export interface Payment {
    transaction_id: string;
    content: string;
    credit_amount: number; // Income
    debit_amount: number; // Expense
    date: Date;
    account_receiver: string;
    account_sender: string;
    name_sender: string;
}

export interface Gate {
    name: string;
    password?: string;
    login_id?: string;
    account: string;
    token: string;
    repeat_interval_in_sec: number;
    device_id?: string;
    get_transaction_day_limit: number;
    get_transaction_count_limit: number;
}

export interface MbBankTransactionDto {
    refNo: string;
    result: { responseCode: string; message: string; ok: boolean };
    transactionHistoryList: {
        postingDate: string; //'14/12/2023 04:29:00';
        transactionDate: string;
        accountNo: string;
        creditAmount: string;
        debitAmount: string;
        currency: 'VND';
        description: string;
        availableBalance: string;
        beneficiaryAccount: null;
        refNo: string;
        benAccountName: string;
        bankName: string;
        benAccountNo: string;
        dueDate: null;
        docId: null;
        transactionType: string;
    }[];
}
