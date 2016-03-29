var _ = require('lodash');
var async = require('async');
var AWS = require('aws-sdk');
var twilio  = require('twilio');

AWS.config.loadFromPath('./aws-config.json');

var sqs = new AWS.SQS();
var sqsQueueUrl = 'https://sqs.eu-west-1.amazonaws.com/756700858752/testlio-sms';
var sqsReceiveParams = {
    QueueUrl: sqsQueueUrl,
    AttributeNames: ['ApproximateNumberOfMessages | RedrivePolicy'],
    MaxNumberOfMessages: 10,
    VisibilityTimeout: 5 * 60,
    WaitTimeSeconds: 10
};

// Test accound SID and Auth Tocken
var twilioClient = twilio('AC2276914d0a02266daa731e62fcb75911', '9a94ace3362f0f0087297203fa3dcf5d');

var pollBound;
var prevPollStartTime, prevPollTimeoutTime;
var pollTimes = [];
// Timeout to start next poll in milliseconds
var pollTimeout = 30 * 1000;

function triggerPoll(context) {
    console.log('Trying to trigger poll of SQS queue');

    if (context.getRemainingTimeInMillis() < getAveragePollTime()) {
        console.log('EXIT: Remaining Lambda time less than average poll time');
        context.done(null);
        return;
    }

    // Saving start of current poll
    prevPollStartTime = _.now();
    prevPollTimeoutTime = 0;

    doPoll();
}

function getAveragePollTime() {
    if (_.isUndefined(prevPollStartTime)) return 0;

    var currentPollTime = _.now() - prevPollStartTime - prevPollTimeoutTime;
    pollTimes.push(currentPollTime);
    console.log('Current poll time: %s ms', currentPollTime);

    var meanPollTime = _.mean(pollTimes);
    console.log('Current mean of poll times: %s ms', meanPollTime);

    return meanPollTime;
}

function doPoll() {
    console.log('Sending request to SQS queue');
    sqs.receiveMessage(sqsReceiveParams, handleSQSResponse);
}

function handleSQSResponse(err, response) {
    console.log('Receiving respose from SQS queue');
    if (err) console.error(err);

    var messagesLength = _.get(response, 'Messages.length', 0);

    // In case of non-empty response, wait until all are messages processed before triggering next poll
    if (messagesLength > 0) {
        console.log('Received %s SQS messages', messagesLength);

        async.each(response.Messages, processSQSMessage, function() {
            console.log('Successfully processed all SQS messages');
            // Q: Probably we don't need to wait before triggering next poll, there might be delays if some of the
            // requests to Twilio time out
            triggerPollBound();
        });
    // In case of empty response or error, wait before triggering next poll
    } else {
        console.log('Received empty response or error. Triggering poll in %s seconds', pollTimeout / 1000);
        prevPollTimeoutTime = pollTimeout;
        // Q: Since we're still paying Amazon for waiting untill callback is scheduled, maybe it's unreasonable to wait
        // at all.
        // But if the number of SQS Gets is limited this might still make sence
        setTimeout(triggerPollBound, pollTimeout);
    }
}

function processSQSMessage(message, done) {
    console.log('Processing SQS message: ', message.MessageId);

    sendSMS(message)
        // We're not waiting for actual deletion of message from SQS, because next poll won't be able to see it until
        // it is allowed by VisibilityTimeout setting
        .then(_.partial(deleteMessageFromSQS, message))
        .finally(function() {
            console.log('Successfully procesed SQS message: ', message.MessageId);
            done();
        });
}

function parseMessageBody(message) {
    try {
        // Error may occur during parsing
        return JSON.parse(message.Body);
    } catch(e) {
        // TODO: Detailed log about the request should be here
        console.log('Failed to parse JSON for message: ', message.MessageId);
        return {};
    }
}

function prepareTwillioMessage(message) {
    var parsedBody = parseMessageBody(message);

    return {
        from: parsedBody.from,
        to: parsedBody.to,
        body: parsedBody.message
    };
}

function sendSMS(message, messageBody) {
    console.log('Sending Twilio SMS for message with ID: %s and Body: %s', message.MessageId, message.Body);

    return twilioClient.sendMessage(prepareTwillioMessage(message))
        .then(function(data) {
            console.log('Sucessfully sent Twillio SMS. Response data: %s', JSON.stringify(data));
        })
        .catch(function(err) {
            console.log('Failed to send Twillio SMS for message: ', message.MessageId);
            console.error(err);

            return Promise.reject(err);
        });
}

function deleteMessageFromSQS(message) {
    console.log(
        'Deleting message from SQS queue: %s',
        JSON.stringify({
            MessageId: message.MessageId,
            ReceiptHandle: message.ReceiptHandle
        })
    );

    sqs.deleteMessage({ QueueUrl: sqsQueueUrl, ReceiptHandle: message.ReceiptHandle }, function(err, data) {
        if (err) {
            console.log(
                'Failed to delete message from SQS queue: %s',
                JSON.stringify({
                    MessageId: message.MessageId,
                    ReceiptHandle: message.ReceiptHandle
                })
            );
            console.error(err);
        }
    });
}

exports.handler = function(event, context) {
    console.log(
        'Starting execution of Lambda function with name: %s and ARN: %s',
        context.functionName,
        context.invokedFunctionArn
    );

    // Binding context to poll function so it can always access it
    triggerPollBound = triggerPoll.bind(null, context);
    // Start polling
    triggerPollBound();
};
