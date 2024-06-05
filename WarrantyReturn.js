/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log', 'N/format'], function (record, search, log, format) {

    function afterSubmit(context) {
        log.debug('Script Started');

        // Get the new record object
        var newRecord = context.newRecord;
        // Get the ID of the Item Receipt
        var itemReceiptId = newRecord.id;
        // Load the Item Receipt record
        var itemReceipt = record.load({
            type: record.Type.ITEM_RECEIPT,
            id: itemReceiptId,
            isDynamic: false
        });

        // Retrieve the from and to locations
        var toLocationId = itemReceipt.getValue({ fieldId: 'location' });
        var fromLocationId = itemReceipt.getValue({ fieldId: 'transferlocation' });

        // Check the from and to locations. 321 is CB Warehouse, 332 CB Repairs, 5 NG Wh1, 6 NG Wh2.
        // So if going to 321 or 332 and not coming from 321, 332, 5 or 6,
        // it must be coming back from a hub and therefor the warranty needs to be checked.
        if ((toLocationId == 321 || toLocationId == 332) &&
            ![321, 332, 5, 6].includes(fromLocationId)) {
            log.debug('Condition met, processing script.');

            // Retrieve item details from the Item Receipt's line items
            var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
            log.debug('Line Count: ' + lineCount);

            // Loop through each line item on the Item Receipt
            for (var i = 0; i < lineCount; i++) {
                var itemId = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                // Load the item record
                var itemRecord = record.load({ type: record.Type.INVENTORY_ITEM, id: itemId, isDynamic: false });
                // Retrieve the warranty item type from the item record
                var warrantyItemType = itemRecord.getValue({ fieldId: 'custitem_warranty_item_type' });

                // Search for warranty registration record matching criteria
                var warrantyRegSearch = search.create({
                    type: 'customrecord_wrm_warrantyreg',
                    filters: [
                        ['custrecord_warranty_item_type', 'is', warrantyItemType],
                        'AND',
                        ['custrecord_custom_location', 'is', fromLocationId]
                    ],
                    columns: ['internalid', 'custrecord_wrm_reg_warrantyexpire']
                });

                var warrantyRegSearchResults = warrantyRegSearch.run().getRange({ start: 0, end: 1 });

                if (warrantyRegSearchResults.length > 0) {
                    // Get the internal ID and expiration date of the warranty registration record
                    var warrantyRegRecordId = warrantyRegSearchResults[0].getValue({ name: 'internalid' });
                    var warrantyExpireDate = warrantyRegSearchResults[0].getValue({ name: 'custrecord_wrm_reg_warrantyexpire' });
                    // Calculate the number of days until expiration date
                    var today = new Date();
                    var expireDate = format.parse({ type: format.Type.DATE, value: warrantyExpireDate });
                    var timeDiff = expireDate.getTime() - today.getTime();
                    var daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                    // Create warranty time record
                    var warrantyTimeRecord = record.create({ type: 'customrecord_warranty_time', isDynamic: true });
                    warrantyTimeRecord.setValue({ fieldId: 'custrecord_item_type', value: warrantyItemType });
                    warrantyTimeRecord.setValue({ fieldId: 'custrecord_time_pool_location', value: fromLocationId });
                    warrantyTimeRecord.setValue({ fieldId: 'custrecord_days_remaining', value: daysRemaining });

                    try {
                        // Save warranty time record
                        warrantyTimeRecord.save();
                        log.debug('Warranty Time record created with item type: ' + warrantyItemType + ' and days remaining: ' + daysRemaining);
                        // Delete the warranty record
                        record.delete({ type: 'customrecord_wrm_warrantyreg', id: warrantyRegRecordId });
                        log.debug('Warranty record deleted successfully.');
                    } catch (e) {
                        log.error('Error saving or deleting records: ' + e.message);
                    }
                } else {
                    log.debug('No Warranty Registration record found for item type: ' + warrantyItemType + ' and ship-to address: ' + fromLocationId);
                }
            }
        } else {
            log.debug('Condition not met, exiting script. To Location: ' + toLocationId + ' From Location: ' + fromLocationId);
        }

        log.debug('Script Ended');
    }

    return {
        afterSubmit: afterSubmit
    };

});