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
